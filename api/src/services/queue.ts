import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { provisionTenant } from './provisioner.js'; // K8s wrapper
import { getPool } from './db.js';
import { sendAdminAlert } from '../routes/admin.js';

// Provide a stable connection to our newly provisioned Memorystore Redis
const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
});

export const provisionQueue = new Queue('tenant-provisioning', { connection: connection as any });

console.log('[Queue] BullMQ provision queue configured.');

export interface ProvisionJobData {
    userId: string;
    botId: string;
    slug: string;
    name: string;
    email: string;
    flavor: string;
    region: string;
    language: string;
    preferredChannel: string;
    botToken: string;
    timezone?: string;
}

// Background worker that actually talks to K8s/Docker via a rate-limited queue
export const provisionWorker = new Worker(
    'tenant-provisioning',
    async (job: Job<ProvisionJobData>) => {
        console.log(`[Worker] Started provisioning job ${job.id} for slug: ${job.data.slug}`);

        try {
            // Logically decoupled provisioning flow
            const result = await provisionTenant({
                slug: job.data.slug,
                name: job.data.name,
                email: job.data.email,
                flavor: job.data.flavor,
                region: job.data.region,
                language: job.data.language,
                preferredChannel: job.data.preferredChannel,
                botToken: job.data.botToken,
                timezone: job.data.timezone,
            });

            if (!result.success) {
                throw new Error(`K8s provisioning failed for ${job.data.slug}: ${result.error}`);
            }

            console.log(`[Worker] Succeeded provisioning job ${job.id}. Container up.`);

            // Update the Bot ID State successfully
            const pool = getPool();
            await pool.query("UPDATE bots SET status = 'live', deployed_at = NOW() WHERE id = $1", [job.data.botId]);

            await sendAdminAlert(
                `✅ New tenant provisioned via Queue (Blowout Protection)!\n` +
                `Name: ${job.data.name}\nSlug: ${job.data.slug}\nFlavor: ${job.data.flavor}\n`
            );

            return result;
        } catch (error) {
            console.error(`[Worker] Fatal error provisioning job ${job.id}:`, error);

            // Wait to alert admins until it hard-fails entirely or just alert now? Let bullmq retry, but mark it erroring
            const pool = getPool();
            await pool.query("UPDATE bots SET status = 'error' WHERE id = $1", [job.data.botId]);

            await sendAdminAlert(
                `❌ Provisioning Worker FAILED for ${job.data.name} (${job.data.slug})\n` +
                `Error: ${error}`
            );

            throw error; // Let BullMQ handle exponential backoffs
        }
    },
    {
        connection: connection as any,
        // Concurrency protection: Do not provision more than 10 pods simultaneously per worker
        concurrency: 10,
        // Optional limits: max 50 jobs per minute per node
        limiter: {
            max: 50,
            duration: 60000,
        }
    }
);

provisionWorker.on('failed', (job, err) => {
    console.error(`[Worker] Provisioning Job ${job?.id} failed. Error:`, err);
});
