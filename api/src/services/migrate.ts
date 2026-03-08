import * as fs from "fs";
import * as path from "path";
import { withClient } from "./db.js";

export async function runMigrations(): Promise<void> {
    const migrationsDir = path.join(process.cwd(), "migrations");

    if (!fs.existsSync(migrationsDir)) {
        console.log("[migrate] Migrations directory not found at:", migrationsDir);
        return;
    }

    const files = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith(".sql"))
        .sort();

    if (files.length === 0) {
        console.log("[migrate] No migration files found.");
        return;
    }

    await withClient(async (client) => {
        // 1. Ensure migrations table exists
        await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

        // 2. Fetch applied migrations
        const { rows } = await client.query("SELECT name FROM migrations");
        const applied = new Set(rows.map((r: any) => r.name));

        // 3. Filter pending migrations
        const pending = files.filter((f) => !applied.has(f));

        if (pending.length === 0) {
            console.log("[migrate] Database schema is up to date.");
            return;
        }

        console.log(`[migrate] Found ${pending.length} pending migrations.`);

        // 4. Apply pending migrations sequentially
        for (const file of pending) {
            const sqlPath = path.join(migrationsDir, file);
            const sql = fs.readFileSync(sqlPath, "utf8");

            console.log(`[migrate] Applying: ${file}...`);
            try {
                await client.query("BEGIN");
                await client.query(sql);
                await client.query("INSERT INTO migrations (name) VALUES ($1)", [file]);
                await client.query("COMMIT");
                console.log(`[migrate] Successfully applied ${file}`);
            } catch (err: any) {
                await client.query("ROLLBACK");
                console.error(`[migrate] Failed to apply ${file}: ${err.message}`);
                throw err; // Stop on first failure
            }
        }

        console.log("[migrate] All pending migrations applied.");
    });
}
