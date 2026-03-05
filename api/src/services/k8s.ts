import * as k8s from "@kubernetes/client-node";
import * as http from "http";

// ---------------------------------------------------------------------------
// Kubernetes Client Setup
// ---------------------------------------------------------------------------
const kc = new k8s.KubeConfig();
kc.loadFromDefault();

const k8sApi = kc.makeApiClient(k8s.AppsV1Api);
const k8sCoreApi = kc.makeApiClient(k8s.CoreV1Api);

export { k8sApi, k8sCoreApi };

// ---------------------------------------------------------------------------
// Container/Pod Config
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
  platformOnboardingKey?: string;
  tenantPrimaryKey?: string;
  tenantFallbackKey?: string;
  platformEmergencyKey?: string;
  tigerClawApiUrl?: string;
  databaseUrl?: string;
  redisUrl?: string;
  encryptionKey?: string;
  hiveToken?: string;
  gatewayToken?: string;
}

const IMAGE = process.env["TIGER_CLAW_IMAGE"] ?? "ghcr.io/bbrysonelite-max/tiger-claw:latest";
const OPENCLAW_PORT = 18789;
const NAMESPACE = "default";

/**
 * Creates a Kubernetes Deployment and PVC for a new tenant container.
 * Replaces old single-node startContainer (docker.ts).
 */
export async function startContainer(params: ProvisionContainerParams): Promise<string> {
  const deploymentName = `tiger-claw-${params.slug}`;

  // Construct Environment Variables for the Pod
  const env: k8s.V1EnvVar[] = [
    { name: "TENANT_ID", value: params.tenantId },
    { name: "TENANT_NAME", value: params.name },
    { name: "PREFERRED_LANGUAGE", value: params.language },
    { name: "BOT_FLAVOR", value: params.flavor },
    { name: "REGION", value: params.region },
    { name: "TIGER_CLAW_API_URL", value: params.tigerClawApiUrl ?? process.env["TIGER_CLAW_API_URL"] ?? "http://tiger-claw-api.default.svc.cluster.local:4000" },
    { name: "DATABASE_URL", value: params.databaseUrl ?? process.env["DATABASE_URL"] ?? "" },
    { name: "REDIS_URL", value: params.redisUrl ?? process.env["REDIS_URL"] ?? "redis://redis-master.default.svc.cluster.local:6379" },
    { name: "ENCRYPTION_KEY", value: params.encryptionKey ?? process.env["ENCRYPTION_KEY"] ?? "" },
  ];

  if (params.botToken) env.push({ name: "TELEGRAM_BOT_TOKEN", value: params.botToken });
  if (params.timezone) env.push({ name: "TZ", value: params.timezone });

  // Key architecture
  if (params.platformOnboardingKey) env.push({ name: "PLATFORM_ONBOARDING_KEY", value: params.platformOnboardingKey });
  if (params.tenantPrimaryKey) env.push({ name: "TENANT_PRIMARY_KEY", value: params.tenantPrimaryKey });
  if (params.tenantFallbackKey) env.push({ name: "TENANT_FALLBACK_KEY", value: params.tenantFallbackKey });

  const emergencyKey = params.platformEmergencyKey ?? process.env["PLATFORM_EMERGENCY_KEY"];
  if (emergencyKey) env.push({ name: "PLATFORM_EMERGENCY_KEY", value: emergencyKey });

  const hiveToken = params.hiveToken ?? process.env["TIGER_CLAW_HIVE_TOKEN"];
  if (hiveToken) env.push({ name: "TIGER_CLAW_HIVE_TOKEN", value: hiveToken });

  const gatewayToken = params.gatewayToken ?? process.env["OPENCLAW_GATEWAY_TOKEN"];
  if (gatewayToken) env.push({ name: "OPENCLAW_GATEWAY_TOKEN", value: gatewayToken });

  const cheapModel = process.env["PLATFORM_CHEAP_MODEL"];
  if (cheapModel) env.push({ name: "PLATFORM_CHEAP_MODEL", value: cheapModel });

  // 1. Create PersistentVolumeClaim (PVC) for SQLite isolation
  const pvcName = `${deploymentName}-pvc`;
  await k8sCoreApi.createNamespacedPersistentVolumeClaim({
    namespace: NAMESPACE,
    body: {
      metadata: { name: pvcName },
      spec: {
        accessModes: ["ReadWriteOnce"],
        resources: { requests: { storage: "1Gi" } }
      }
    }
  }).catch((err) => {
    // If it already exists, that's fine (e.g., container recreation)
    if (err.statusCode !== 409) throw err;
  });

  // 2. Create Deployment
  const deployment: k8s.V1Deployment = {
    metadata: { name: deploymentName },
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: deploymentName } },
      template: {
        metadata: { labels: { app: deploymentName } },
        spec: {
          containers: [
            {
              name: "bot",
              image: IMAGE,
              ports: [{ containerPort: OPENCLAW_PORT }],
              env: env,
              volumeMounts: [{ name: "data-volume", mountPath: "/app/data" }],
              // Kubernetes Native Readiness Probe (Replaces update.sh polling)
              readinessProbe: {
                httpGet: { path: "/readyz", port: OPENCLAW_PORT },
                initialDelaySeconds: 5,
                periodSeconds: 2,
                timeoutSeconds: 3,
                failureThreshold: 10
              },
              // Liveness Probe
              livenessProbe: {
                httpGet: { path: "/health", port: OPENCLAW_PORT },
                initialDelaySeconds: 15,
                periodSeconds: 30
              }
            }
          ],
          volumes: [
            {
              name: "data-volume",
              persistentVolumeClaim: { claimName: pvcName }
            }
          ]
        }
      }
    }
  };

  await k8sApi.createNamespacedDeployment({ namespace: NAMESPACE, body: deployment });

  return deploymentName;
}

export async function stopContainer(slug: string): Promise<void> {
  const deploymentName = `tiger-claw-${slug}`;
  // Scale down to 0 to "suspend" it
  await k8sApi.patchNamespacedDeploymentScale(
    {
      name: deploymentName,
      namespace: NAMESPACE,
      body: { spec: { replicas: 0 } },
    },
    { headers: { "Content-Type": "application/merge-patch+json" } } as any
  ).catch(err => { if (err.statusCode !== 404) throw err; });
}

export async function removeContainer(slug: string, force = false): Promise<void> {
  const deploymentName = `tiger-claw-${slug}`;
  const pvcName = `${deploymentName}-pvc`;

  // Remove Deployment
  await k8sApi.deleteNamespacedDeployment({ name: deploymentName, namespace: NAMESPACE })
    .catch(err => { if (err.statusCode !== 404) throw err; });

  // Optional: Remove PVC if force-purging tenant entirely
  if (force) {
    await k8sCoreApi.deleteNamespacedPersistentVolumeClaim({ name: pvcName, namespace: NAMESPACE })
      .catch(err => { if (err.statusCode !== 404) throw err; });
  }
}

/**
 * Recreate a container with modified env vars.
 * In Kubernetes, this is handled gracefully by patching the Deployment environment array.
 * K8s will automatically do a rolling update.
 */
export async function recreateContainerWithEnv(
  slug: string,
  envUpdates: Record<string, string | undefined>,
): Promise<string> {
  const deploymentName = `tiger-claw-${slug}`;

  // Fetch current deployment to get existing env vars
  // @ts-ignore
  const { body: deployment } = await k8sApi.readNamespacedDeployment({ name: deploymentName, namespace: NAMESPACE });
  const existingEnv = deployment?.spec?.template?.spec?.containers[0]?.env || [];

  const envMap = new Map<string, string>();
  for (const e of existingEnv) {
    if (e.name) envMap.set(e.name, e.value || "");
  }

  for (const [k, v] of Object.entries(envUpdates)) {
    if (v === undefined) envMap.delete(k);
    else envMap.set(k, v);
  }

  const newEnv: k8s.V1EnvVar[] = Array.from(envMap.entries()).map(([k, v]) => ({ name: k, value: v }));

  // Patch Deployment
  await k8sApi.patchNamespacedDeployment(
    {
      name: deploymentName,
      namespace: NAMESPACE,
      body: {
        spec: {
          template: {
            spec: {
              containers: [{ name: "bot", env: newEnv }]
            }
          }
        }
      },
    },
    { headers: { "Content-Type": "application/strategic-merge-patch+json" } } as any
  );

  return deploymentName;
}

// ---------------------------------------------------------------------------
// Health and List Helpers
// ---------------------------------------------------------------------------

export interface ContainerSummary {
  name: string;
  slug: string;
  state: string;
  status: string;
}

export async function listTigerContainers(): Promise<ContainerSummary[]> {
  // @ts-ignore
  const { body: deployments } = await k8sApi.listNamespacedDeployment({ namespace: NAMESPACE, labelSelector: "app" });

  return (deployments?.items || []).filter((d: any) => d.metadata?.name?.startsWith("tiger-claw-")).map((d: any) => {
    const rawName = d.metadata?.name || "";
    const slug = rawName.replace(/^tiger-claw-/, "");
    // Simplistic state mapping based on available replicas vs ready replicas
    const desired = d.spec?.replicas || 0;
    const ready = d.status?.readyReplicas || 0;

    return {
      name: rawName,
      slug,
      state: ready === desired && desired > 0 ? "running" : desired === 0 ? "exited" : "starting",
      status: `Ready: ${ready}/${desired}`
    };
  });
}
