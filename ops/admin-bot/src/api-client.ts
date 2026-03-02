// Tiger Claw Admin Bot — API Client
// Thin HTTP wrapper around the Tiger Claw API (port 4000)
// All admin bot commands go through this client.

import * as https from "https";
import * as http from "http";

const API_BASE = process.env["TIGER_CLAW_API_URL"] ?? "http://localhost:4000";
const ADMIN_TOKEN = process.env["ADMIN_TOKEN"] ?? "";

// ---------------------------------------------------------------------------
// Generic request helper
// ---------------------------------------------------------------------------

function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE);
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ADMIN_TOKEN}`,
        ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const transport = url.protocol === "https:" ? https : http;

    const req = transport.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data) as T;
          resolve(parsed);
        } catch {
          reject(new Error(`Non-JSON response (${res.statusCode}): ${data.slice(0, 200)}`));
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(15000, () => {
      req.destroy();
      reject(new Error("Request timed out (15s)"));
    });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Typed API methods
// ---------------------------------------------------------------------------

export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  email?: string;
  status: string;
  flavor: string;
  region: string;
  language: string;
  preferredChannel: string;
  port?: number;
  containerName?: string;
  lastActivityAt?: string;
  suspendedAt?: string;
  suspendedReason?: string;
  createdAt: string;
}

export interface TenantDetail extends TenantSummary {
  health?: {
    httpReachable: boolean;
    gatewayStatus?: string;
    channelConnections?: Record<string, string>;
    lastAgentActivity?: string;
    memoryMb?: number;
    keyLayerActive?: number;
    checkedAt: string;
  };
  containerStats?: {
    memoryUsageMb: number;
    memoryLimitMb: number;
    memoryPercent: number;
    running: boolean;
  };
}

export interface FleetResponse {
  count: number;
  tenants: TenantSummary[];
}

export interface HealthResponse {
  status: string;
  uptimeSec: number;
  responseMs: number;
  checks: Record<string, unknown>;
  fleet: { total: number; running: number; stopped: number };
  system: { totalMemMb: number; freeMemMb: number; usedMemPercent: number; loadAvg1m: number };
  timestamp: string;
}

export interface ProvisionInput {
  slug: string;
  name: string;
  email?: string;
  flavor: string;
  region: string;
  language: string;
  preferredChannel: string;
  botToken?: string;
  timezone?: string;
  port?: number;
}

export interface ProvisionResult {
  success: boolean;
  tenant?: TenantSummary;
  port?: number;
  error?: string;
  steps: string[];
}

// Fleet
export const getFleet = () => request<FleetResponse>("GET", "/admin/fleet");
export const getTenant = (idOrSlug: string) => request<TenantDetail>("GET", `/admin/fleet/${idOrSlug}`);

// Provisioning
export const provisionTenant = (data: ProvisionInput) =>
  request<ProvisionResult>("POST", "/admin/provision", data);

// Lifecycle
export const suspendTenant = (idOrSlug: string, reason?: string) =>
  request<{ ok: boolean }>("POST", `/admin/fleet/${idOrSlug}/suspend`, { reason });

export const resumeTenant = (idOrSlug: string) =>
  request<{ ok: boolean }>("POST", `/admin/fleet/${idOrSlug}/resume`);

export const terminateTenant = (idOrSlug: string) =>
  request<{ ok: boolean }>("DELETE", `/admin/fleet/${idOrSlug}`);

// Operations
export const triggerReport = (idOrSlug: string) =>
  request<{ ok: boolean; triggered: boolean }>("POST", `/admin/fleet/${idOrSlug}/report`);

export const getTenantLogs = (idOrSlug: string, tail = 50) =>
  request<{ lines: string[] }>("GET", `/admin/fleet/${idOrSlug}/logs?tail=${tail}`);

// System health
export const getSystemHealth = () => request<HealthResponse>("GET", "/health");

// Recent events (for daily briefing)
export interface RecentEventsResponse {
  totalEvents: number;
  keyFailures: number;
  keyFailureDetails: Array<{ tenantName: string; action: string; at: string; details?: Record<string, unknown> }>;
  containerRestarts: number;
}
export const getRecentEvents = () => request<RecentEventsResponse>("GET", "/admin/events/recent");

// Generic helpers (used by update.ts for canary commands and deploy integration)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const apiGet    = (path: string) => request<any>("GET",    path);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const apiPost   = (path: string, body?: unknown) => request<any>("POST",   path, body);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const apiDelete = (path: string) => request<any>("DELETE", path);

// Canary group management
export const getCanaryTenants  = () => request<FleetResponse>("GET", "/admin/canary");
export const addCanaryTenant   = (idOrSlug: string) =>
  request<{ ok: boolean }>("POST",   `/admin/fleet/${idOrSlug}/canary`);
export const removeCanaryTenant = (idOrSlug: string) =>
  request<{ ok: boolean }>("DELETE", `/admin/fleet/${idOrSlug}/canary`);
