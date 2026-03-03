# deployment_state.json Schema

**Source:** TIGERCLAW-BLUEPRINT-v3.md §4.2 (LOCKED decision B4.3)
**TypeScript interface:** `api/src/services/deploymentState.ts`
**File location:** `{REPO_ROOT}/deployment_state.json` (server-level, not per-container)

---

## Schema

```json
{
  "tigerClaw": {
    "current": "v2026.03.03.1",
    "previous": "v2026.02.27.1"
  },
  "openClaw": {
    "current": "2026.3.2",
    "previous": "2026.3.1"
  },
  "imageTag": "ghcr.io/bbrysonelite-max/tiger-claw:v2026.03.03.1-oc2026.3.2",
  "builds": [
    {
      "tcVersion": "v2026.03.03.1",
      "ocVersion": "2026.3.2",
      "imageTag": "ghcr.io/bbrysonelite-max/tiger-claw:v2026.03.03.1-oc2026.3.2",
      "builtAt": "2026-03-03T12:00:00Z",
      "commitHash": "8e4bc65",
      "gitTagged": true
    }
  ],
  "canary": {
    "group": ["slug-a", "slug-b", "slug-c", "slug-d", "slug-e"],
    "startedAt": "2026-03-03T12:30:00Z",
    "stage": "canary"
  },
  "rollout": {
    "stage": "canary",
    "percentage": 0,
    "startedAt": "2026-03-03T12:30:00Z"
  },
  "tenants": {
    "slug-a": {
      "imageTag": "ghcr.io/bbrysonelite-max/tiger-claw:v2026.03.03.1-oc2026.3.2",
      "updatedAt": "2026-03-03T12:31:00Z",
      "successCount": 1,
      "failureCount": 0,
      "consecutiveFailures": 0
    }
  },
  "rollback": null
}
```

---

## Field Reference

### `tigerClaw`

| Field | Type | Description |
|-------|------|-------------|
| `current` | string | Current Tiger Claw version (e.g., `v2026.03.03.1`) |
| `previous` | string | Previous TC version (for rollback reference) |

### `openClaw`

| Field | Type | Description |
|-------|------|-------------|
| `current` | string | Current OpenClaw version (e.g., `2026.3.2`) |
| `previous` | string | Previous OC version |

### `imageTag`

Type: `string` — Full GHCR image reference for the current active build (e.g., `ghcr.io/bbrysonelite-max/tiger-claw:v2026.03.03.1-oc2026.3.2`).

### `builds`

Array of the last 5 build records (LOCKED: max 5). Most recent first.

| Field | Type | Description |
|-------|------|-------------|
| `tcVersion` | string | Tiger Claw version for this build |
| `ocVersion` | string | OpenClaw version baked into the image |
| `imageTag` | string | Full GHCR image reference |
| `builtAt` | string (ISO 8601) | Build timestamp (UTC) |
| `commitHash` | string | Git short SHA at build time |
| `gitTagged` | boolean | Whether a git tag was created for this build |

### `canary`

| Field | Type | Description |
|-------|------|-------------|
| `group` | string[] | 5 tenant slugs in the canary group |
| `startedAt` | string \| null | ISO timestamp when canary deployment started |
| `stage` | string | Current canary stage: `none`, `canary` |

### `rollout`

| Field | Type | Description |
|-------|------|-------------|
| `stage` | string | Current rollout stage: `none`, `canary`, `10%`, `25%`, `50%`, `100%` |
| `percentage` | number | Fleet percentage at current stage (0–100) |
| `startedAt` | string \| null | ISO timestamp when current stage began |

### `tenants`

Map of `slug → TenantUpdateRecord`. Tracks per-tenant update results.

| Field | Type | Description |
|-------|------|-------------|
| `imageTag` | string | Image tag currently running on this tenant's container |
| `updatedAt` | string (ISO 8601) | Last successful update timestamp |
| `successCount` | number | Total successful updates for this tenant |
| `failureCount` | number | Total failed updates |
| `consecutiveFailures` | number | Consecutive failures (resets to 0 on success). 3+ triggers auto-rollback. |
| `lastFailedAt` | string (ISO 8601) | Timestamp of last failure (if any) |

### `rollback`

Nullable. Present when a rollback has been executed.

| Field | Type | Description |
|-------|------|-------------|
| `rolledBackAt` | string (ISO 8601) | When the rollback was executed |
| `rolledBackFrom` | string | Image tag that was rolled back from |
| `rolledBackTo` | string | Image tag that was rolled back to |

---

## Read/Write Ownership

| Script / Module | Reads | Writes |
|-----------------|-------|--------|
| `ops/build.sh` | `builds` (to determine next build number) | `tigerClaw`, `openClaw`, `imageTag`, `builds` |
| `ops/update.sh` | — | `tenants.{slug}` (success/failure counts) |
| `api/src/routes/update.ts` | All fields | `canary`, `rollout`, `rollback`, `tigerClaw`, `openClaw`, `imageTag` |
| `api/src/services/deploymentState.ts` | All fields (read helper) | All fields (write helper with file locking) |
| `ops/admin-bot/commands/update.ts` | — (reads via API) | — (writes via API) |

---

## File Locking

Concurrent writes are protected by a `.lock` sidecar file (`deployment_state.json.lock`):

1. Writer creates `deployment_state.json.lock` with `O_EXCL` (exclusive create).
2. If lock exists and is older than 30 seconds, it is assumed stale and reclaimed.
3. If lock exists and is fresh, writer retries up to 10 times with 50ms delay.
4. After writing, the lock file is removed in a `finally` block.

The TypeScript helpers (`readDeploymentState`, `writeDeploymentState`, `updateTenantRecord`) in `api/src/services/deploymentState.ts` implement this locking. The bash scripts (`build.sh`, `update.sh`) use Python's `open()` for writes — these are atomic at the OS level for small files but do not coordinate with the TypeScript lock. In practice, builds and updates are admin-initiated and sequential.
