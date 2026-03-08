// Tiger Claw API — Hive Pattern Endpoints
// Cross-tenant anonymous learning system — server side
// TIGERCLAW-MASTER-SPEC-v2.md Block 1.4, Block 5.3, Block 7.1
//
// GET  /hive/patterns           — query approved patterns (used by tiger_hive.ts in containers)
// POST /hive/patterns           — submit anonymous pattern (used by tiger_hive.ts in containers)
//
// Auth: containers authenticate via TIGER_CLAW_HIVE_TOKEN header
// All submissions must be anonymous (no PII). Server-side PII check enforced here.

import { Router, type Request, type Response } from "express";
import { queryHivePatterns, insertHivePattern } from "../services/db.js";
import * as crypto from "crypto";

const router = Router();

const HIVE_TOKEN = process.env["TIGER_CLAW_HIVE_TOKEN"] ?? "";

// ---------------------------------------------------------------------------
// Hive auth middleware — lightweight shared token
// ---------------------------------------------------------------------------

function requireHiveAuth(req: Request, res: Response, next: () => void): void {
  if (!HIVE_TOKEN) {
    // Dev mode: no auth
    next();
    return;
  }
  const token = req.headers["x-hive-token"] ?? req.headers["authorization"];
  if (!token || token !== HIVE_TOKEN) {
    res.status(401).json({ error: "Invalid hive token" });
    return;
  }
  next();
}

router.use(requireHiveAuth);

// ---------------------------------------------------------------------------
// GET /hive/patterns
// ---------------------------------------------------------------------------

router.get("/patterns", async (req: Request, res: Response) => {
  const flavor = req.query["flavor"] as string | undefined;
  const region = req.query["region"] as string | undefined;
  const category = req.query["category"] as string | undefined;
  const limit = Number(req.query["limit"] ?? 10);

  if (!flavor) {
    return res.status(400).json({ error: "flavor is required" });
  }

  try {
    const patterns = await queryHivePatterns({ flavor, region, category, limit });
    return res.json({
      count: patterns.length,
      patterns: patterns.map((p) => ({
        id: p.id,
        flavor: p.flavor,
        region: p.region,
        category: p.category,
        observation: p.observation,
        dataPoints: p.dataPoints,
        confidence: p.confidence,
        submittedAt: p.submittedAt.toISOString(),
      })),
    });
  } catch (err) {
    console.error("[hive] GET /patterns error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// POST /hive/patterns
// ---------------------------------------------------------------------------

interface SubmitPatternBody {
  flavor: string;
  region: string;
  category: string;
  observation: string;
  dataPoints?: number;
  confidence?: number;
  tenantId?: string;   // raw tenant ID — will be hashed before storage
}

router.post("/patterns", async (req: Request, res: Response) => {
  const body = req.body as Partial<SubmitPatternBody>;

  const required: (keyof SubmitPatternBody)[] = ["flavor", "region", "category", "observation"];
  const missing = required.filter((k) => !body[k]);
  if (missing.length > 0) {
    return res.status(400).json({ error: `Missing fields: ${missing.join(", ")}` });
  }

  const observation = body["observation"]!;

  // Server-side PII detection (mirrors tiger_hive.ts client-side check)
  const piiWarnings = detectPii(observation);
  if (piiWarnings.length > 0) {
    return res.status(422).json({
      error: "Observation contains potential PII — submission rejected",
      piiDetected: piiWarnings,
    });
  }

  // Hash tenant ID for anonymous cross-reference (never store raw ID)
  const tenantHash = body["tenantId"]
    ? crypto.createHash("sha256").update(body["tenantId"]).digest("hex").slice(0, 16)
    : undefined;

  try {
    const pattern = await insertHivePattern({
      flavor: body["flavor"]!,
      region: body["region"]!,
      category: body["category"]!,
      observation,
      dataPoints: body["dataPoints"] ?? 1,
      confidence: Math.min(Math.max(body["confidence"] ?? 50, 0), 100),
      tenantHash,
    });
    return res.status(201).json({
      id: pattern.id,
      submittedAt: pattern.submittedAt.toISOString(),
    });
  } catch (err) {
    console.error("[hive] POST /patterns error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------------------------------------------------------------------------
// PII Detection (mirrors tiger_hive.ts — must stay in sync)
// ---------------------------------------------------------------------------

function detectPii(text: string): string[] {
  const warnings: string[] = [];
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text)) {
    warnings.push("email address");
  }
  if (/\b(\+\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/.test(text)) {
    warnings.push("phone number");
  }
  if (/\b[A-Z][a-z]+ [A-Z][a-z]+\b/.test(text)) {
    warnings.push("possible full name");
  }
  return warnings;
}

export default router;
