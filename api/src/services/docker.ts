// Tiger Claw API — Docker Service
// Programmatic container lifecycle management via Docker Engine API
// TIGERCLAW-MASTER-SPEC-v2.md Block 5.1, Block 6.2
//
// Operations:
//   startContainer     — launch a new per-tenant OpenClaw container
//   stopContainer      — stop (suspend) a running container
//   removeContainer    — remove a container permanently
//   getContainerHealth — query OpenClaw /health endpoint for a tenant
//   getContainerLogs   — tail last N log lines from a container
//   inspectContainer   — get runtime stats (memory, uptime, status)
//   listTigerContainers — list all tiger-claw-* containers

import Dockerode from "dockerode";
import * as http from "http";

// ---------------------------------------------------------------------------
// Docker client (connects to local Docker socket)
// ---------------------------------------------------------------------------

const docker = new Dockerode({ socketPath: "/var/run/docker.sock" });

export { docker };

// ---------------------------------------------------------------------------
// Container config
// ---------------------------------------------------------------------------

export interface ProvisionContainerParams {
  slug: string;
  tenantId: string;
  name: string;
  port: number;
  language: string;
  flavor: string;
  region: string;
  botToken?: string;
  timezone?: string;
  // Four-layer key system (Block 1.7, Block 4)
  platformOnboardingKey?: string;   // Layer 1
  tenantPrimaryKey?: string;        // Layer 2
  tenantFallbackKey?: string;       // Layer 3
  platformEmergencyKey?: string;    // Layer 4
  tigerClawApiUrl?: string;
  databaseUrl?: string;
  redisUrl?: string;
  encryptionKey?: string;
  hiveToken?: string;
  gatewayToken?: string;
}

const IMAGE = process.env["TIGER_CLAW_IMAGE"] ?? "tiger-claw-scout:latest";
const OPENCLAW_PORT = 18789;
const CUSTOMERS_DIR = process.env["CUSTOMERS_DIR"] ?? "/home/ubuntu/customers";

export async function startContainer(params: ProvisionContainerParams): Promise<string> {
  const containerName = `tiger-claw-${params.slug}`;

  const env: string[] = [
    `TENANT_ID=${params.tenantId}`,
    `TENANT_NAME=${params.name}`,
    `PREFERRED_LANGUAGE=${params.language}`,
    `BOT_FLAVOR=${params.flavor}`,
    `REGION=${params.region}`,
    `TIGER_CLAW_API_URL=${params.tigerClawApiUrl ?? process.env["TIGER_CLAW_API_URL"] ?? "http://host.docker.internal:4000"}`,
    `DATABASE_URL=${params.databaseUrl ?? process.env["DATABASE_URL"] ?? ""}`,
    `REDIS_URL=${params.redisUrl ?? process.env["REDIS_URL"] ?? "redis://host.docker.internal:6379"}`,
    `ENCRYPTION_KEY=${params.encryptionKey ?? process.env["ENCRYPTION_KEY"] ?? ""}`,
  ];

  if (params.botToken) env.push(`TELEGRAM_BOT_TOKEN=${params.botToken}`);
  if (params.timezone) env.push(`TZ=${params.timezone}`);
  if (params.platformOnboardingKey) env.push(`PLATFORM_ONBOARDING_KEY=${params.platformOnboardingKey}`);
  if (params.tenantPrimaryKey) env.push(`TENANT_PRIMARY_KEY=${params.tenantPrimaryKey}`);
  if (params.tenantFallbackKey) env.push(`TENANT_FALLBACK_KEY=${params.tenantFallbackKey}`);

  // Layer 4 + hive/gateway tokens: always inject from platform env if available
  const emergencyKey = params.platformEmergencyKey ?? process.env["PLATFORM_EMERGENCY_KEY"];
  if (emergencyKey) env.push(`PLATFORM_EMERGENCY_KEY=${emergencyKey}`);
  const hiveToken = params.hiveToken ?? process.env["TIGER_CLAW_HIVE_TOKEN"];
  if (hiveToken) env.push(`TIGER_CLAW_HIVE_TOKEN=${hiveToken}`);
  const gatewayToken = params.gatewayToken ?? process.env["OPENCLAW_GATEWAY_TOKEN"];
  if (gatewayToken) env.push(`OPENCLAW_GATEWAY_TOKEN=${gatewayToken}`);
  const cheapModel = process.env["PLATFORM_CHEAP_MODEL"];
  if (cheapModel) env.push(`PLATFORM_CHEAP_MODEL=${cheapModel}`);

  // Pass Serper keys if configured
  for (const k of ["SERPER_KEY_1", "SERPER_KEY_2", "SERPER_KEY_3"]) {
    if (process.env[k]) env.push(`${k}=${process.env[k]}`);
  }

  // Ensure host directory layout exists for persistent volume + ops compatibility
  const customerDir = `${CUSTOMERS_DIR}/${params.slug}`;
  const dataDir = `${customerDir}/data`;
  const fs = await import("fs");
  fs.mkdirSync(dataDir, { recursive: true });

  // Write docker-compose.yml so deploy.sh and backup.sh can manage this tenant
  const composeContent = [
    `version: "3.8"`,
    `services:`,
    `  bot:`,
    `    container_name: ${containerName}`,
    `    image: ${IMAGE}`,
    `    restart: unless-stopped`,
    `    ports:`,
    `      - "${params.port}:${OPENCLAW_PORT}"`,
    `    volumes:`,
    `      - ${dataDir}:/app/data`,
    `    extra_hosts:`,
    `      - "host.docker.internal:host-gateway"`,
    `    environment:`,
    ...env.map((e) => `      - ${e}`),
    ``,
  ].join("\n");
  fs.writeFileSync(`${customerDir}/docker-compose.yml`, composeContent, "utf8");

  const container = await docker.createContainer({
    name: containerName,
    Image: IMAGE,
    Env: env,
    ExposedPorts: { [`${OPENCLAW_PORT}/tcp`]: {} },
    HostConfig: {
      PortBindings: {
        [`${OPENCLAW_PORT}/tcp`]: [{ HostPort: String(params.port) }],
      },
      Binds: [`${dataDir}:/app/data`],
      RestartPolicy: { Name: "unless-stopped" },
      ExtraHosts: ["host.docker.internal:host-gateway"],
    },
  });

  await container.start();
  return container.id;
}

export async function stopContainer(slug: string): Promise<void> {
  const name = `tiger-claw-${slug}`;
  try {
    const container = docker.getContainer(name);
    await container.stop({ t: 10 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Already stopped is fine
    if (!msg.includes("not running") && !msg.includes("304")) throw err;
  }
}

export async function startExistingContainer(slug: string): Promise<void> {
  const name = `tiger-claw-${slug}`;
  const container = docker.getContainer(name);
  await container.start();
}

export async function removeContainer(slug: string, force = false): Promise<void> {
  const name = `tiger-claw-${slug}`;
  try {
    const container = docker.getContainer(name);
    await container.remove({ force });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("No such container")) throw err;
  }
}

/**
 * Recreate a container with modified env vars. Inspects the running container,
 * stops/removes it, and creates a new one with the same config + env changes.
 * envUpdates: key-value pairs to set (value=undefined removes the var).
 */
export async function recreateContainerWithEnv(
  slug: string,
  envUpdates: Record<string, string | undefined>,
): Promise<string> {
  const name = `tiger-claw-${slug}`;
  const container = docker.getContainer(name);
  const info = await container.inspect();

  // Build updated env list
  const existingEnv = info.Config.Env ?? [];
  const envMap = new Map<string, string>();
  for (const entry of existingEnv) {
    const eqIdx = entry.indexOf("=");
    if (eqIdx > 0) envMap.set(entry.slice(0, eqIdx), entry.slice(eqIdx + 1));
  }
  for (const [k, v] of Object.entries(envUpdates)) {
    if (v === undefined) envMap.delete(k);
    else envMap.set(k, v);
  }
  const newEnv = Array.from(envMap.entries()).map(([k, v]) => `${k}=${v}`);

  // Preserve config from current container
  const portBindings = info.HostConfig.PortBindings ?? {};
  const binds = info.HostConfig.Binds ?? [];
  const extraHosts = info.HostConfig.ExtraHosts ?? [];
  const restartPolicy = info.HostConfig.RestartPolicy ?? { Name: "unless-stopped" };
  const image = info.Config.Image;
  const exposedPorts = info.Config.ExposedPorts ?? {};

  // Stop and remove
  try { await container.stop({ t: 10 }); } catch { /* already stopped */ }
  try { await container.remove({ force: true }); } catch { /* already removed */ }

  // Recreate
  const newContainer = await docker.createContainer({
    name,
    Image: image,
    Env: newEnv,
    ExposedPorts: exposedPorts,
    HostConfig: {
      PortBindings: portBindings,
      Binds: binds,
      RestartPolicy: restartPolicy,
      ExtraHosts: extraHosts,
    },
  });

  await newContainer.start();
  return newContainer.id;
}

export async function getContainerLogs(slug: string, tail = 50): Promise<string[]> {
  const name = `tiger-claw-${slug}`;
  const container = docker.getContainer(name);

  const logBuffer = await container.logs({
    stdout: true,
    stderr: true,
    tail,
    timestamps: true,
  });

  // Docker log stream has 8-byte header on each frame — strip it
  const raw = logBuffer.toString("utf8");
  const lines = raw
    .split("\n")
    .map((l) => (l.length > 8 ? l.slice(8) : l))
    .filter((l) => l.trim().length > 0);

  return lines.slice(-tail);
}

// ---------------------------------------------------------------------------
// Container readiness check via OpenClaw /readyz (ADR-0008)
// Used by provisioner only — returns true when gateway is fully initialized.
// ---------------------------------------------------------------------------

export async function getContainerReady(slug: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: "localhost", port, path: "/readyz", timeout: 5000 },
      (res) => {
        resolve(res.statusCode === 200);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

// ---------------------------------------------------------------------------
// Per-container health check via OpenClaw /health (fleet liveness monitor)
// ---------------------------------------------------------------------------

export interface ContainerHealth {
  slug: string;
  port: number;
  httpReachable: boolean;
  gatewayStatus?: string;
  channelConnections?: Record<string, string>;
  lastAgentActivity?: string;
  memoryMb?: number;
  keyLayerActive?: number;
  rawResponse?: unknown;
  checkedAt: string;
}

export async function getContainerHealth(slug: string, port: number): Promise<ContainerHealth> {
  const checkedAt = new Date().toISOString();

  return new Promise((resolve) => {
    const req = http.get(
      { hostname: "localhost", port, path: "/health", timeout: 5000 },
      (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => {
          try {
            const data = JSON.parse(body) as Record<string, unknown>;
            resolve({
              slug,
              port,
              httpReachable: true,
              gatewayStatus: data["gatewayStatus"] as string | undefined,
              channelConnections: data["channelConnections"] as Record<string, string> | undefined,
              lastAgentActivity: data["lastAgentActivity"] as string | undefined,
              memoryMb: data["memoryMb"] as number | undefined,
              keyLayerActive: data["keyLayerActive"] as number | undefined,
              rawResponse: data,
              checkedAt,
            });
          } catch {
            resolve({ slug, port, httpReachable: true, checkedAt });
          }
        });
      }
    );

    req.on("error", () =>
      resolve({ slug, port, httpReachable: false, checkedAt })
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ slug, port, httpReachable: false, checkedAt });
    });
  });
}

// ---------------------------------------------------------------------------
// Container stats (memory usage)
// ---------------------------------------------------------------------------

export interface ContainerStats {
  slug: string;
  memoryUsageMb: number;
  memoryLimitMb: number;
  memoryPercent: number;
  running: boolean;
}

export async function inspectContainer(slug: string): Promise<ContainerStats | null> {
  const name = `tiger-claw-${slug}`;
  try {
    const container = docker.getContainer(name);
    const info = await container.inspect();
    const running = info.State?.Running ?? false;

    if (!running) {
      return { slug, memoryUsageMb: 0, memoryLimitMb: 0, memoryPercent: 0, running: false };
    }

    // Stats stream (one-shot)
    const stats = await new Promise<Record<string, unknown>>((resolve, reject) => {
      container.stats({ stream: false }, (err, data) => {
        if (err) return reject(err);
        resolve(data as Record<string, unknown>);
      });
    });

    const mem = stats["memory_stats"] as Record<string, number> | undefined;
    const usage = mem?.["usage"] ?? 0;
    const limit = mem?.["limit"] ?? 1;

    return {
      slug,
      memoryUsageMb: Math.round(usage / 1024 / 1024),
      memoryLimitMb: Math.round(limit / 1024 / 1024),
      memoryPercent: Math.round((usage / limit) * 100),
      running: true,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// List all tiger-claw containers
// ---------------------------------------------------------------------------

export interface ContainerSummary {
  name: string;
  slug: string;
  state: string;
  status: string;
}

export async function listTigerContainers(): Promise<ContainerSummary[]> {
  const containers = await docker.listContainers({
    all: true,
    filters: JSON.stringify({ name: ["tiger-claw-"] }),
  });

  return containers.map((c) => {
    const rawName = (c.Names?.[0] ?? "").replace(/^\//, "");
    const slug = rawName.replace(/^tiger-claw-/, "");
    return {
      name: rawName,
      slug,
      state: c.State,
      status: c.Status,
    };
  });
}

// ---------------------------------------------------------------------------
// Health monitor — used by the 30-second polling loop in index.ts
// ---------------------------------------------------------------------------

export interface FleetHealthSummary {
  checkedAt: string;
  containers: ContainerHealth[];
  alerts: string[];
}

export async function checkFleetHealth(
  tenants: Array<{ slug: string; port: number }>
): Promise<FleetHealthSummary> {
  const checks = await Promise.all(
    tenants.map((t) => getContainerHealth(t.slug, t.port))
  );

  const alerts: string[] = [];
  for (const c of checks) {
    if (!c.httpReachable) {
      alerts.push(`Container ${c.slug} is unreachable on port ${c.port}`);
    }
    if (c.memoryMb !== undefined && c.memoryMb > 400) {
      alerts.push(`Container ${c.slug} memory: ${c.memoryMb}MB (high)`);
    }
  }

  return { checkedAt: new Date().toISOString(), containers: checks, alerts };
}
