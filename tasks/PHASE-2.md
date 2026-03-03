# Phase 2 — Update Pipeline

**Status:** ACTIVE
**Prerequisite:** Phase 1 complete (verified — SecretRef key rotation, provisioner edge cases, ACP dispatch assessment)
**Completion signal:** All five tasks below are checked off, committed, and verified with a canary deployment test.

---

## Phase 1 Carry-Forward Notes

1. **SecretRef validated in code, not yet in live container.** P1-3/P1-4 implemented SecretRef key rotation and seeding in `entrypoint.sh`, but end-to-end validation with real API keys is pending. Validate during the first canary deployment (P2-5).
2. **`openclaw config validate` CLI available.** v2026.3.2 added `openclaw config validate --json`. Consider adding this to `ops/build.sh` as a post-build config check.
3. **Image naming convention locked.** Blueprint B4.2: `tiger-claw:{TC_VERSION}-oc{OC_VERSION}`. Example: `tiger-claw:v2026.03.03.1-oc2026.3.2`.
4. **Container data persists across replacement.** All tenant data lives in Docker volumes — container image is stateless. See Blueprint §4.5.

---

### Task P2-1: Harden `ops/build.sh`

**Blueprint ref:** B4.1, B4.2, §4.6

**Context:** The build script must produce immutable Docker images with parameterized version tagging. Containers are never updated in-place — a new image is built with the target OpenClaw version baked in.

- [x] Accept `--tc-version` and `--oc-version` CLI arguments (both required, error on missing)
- [x] Generate image tag in locked format: `tiger-claw:{TC_VERSION}-oc{OC_VERSION}`
- [x] Build Docker image using `docker/customer/Dockerfile` with both build args
- [x] Config validate skipped — `openclaw.json` is generated at runtime by `entrypoint.sh` (no static config at build time). Config validated by `/readyz` at container startup.
- [x] Push image to GHCR: `ghcr.io/bbrysonelite-max/tiger-claw:{tag}` (requires `GITHUB_TOKEN`)
- [x] Print full image tag to stdout on success for use by `ops/update.sh`
- [x] Error handling: fail fast on build errors, missing args, missing `GITHUB_TOKEN`, or push failures

---

### Task P2-2: Build `ops/update.sh`

**Blueprint ref:** B4.1, §4.4, §4.5, §4.6

**Context:** Single-tenant container replace flow. Stops the old container, pulls the new image, starts a new container with the same volume mounts, verifies `/readyz`, and rolls back on failure. Must preserve all tenant data (volumes are not touched).

- [ ] Accept `--slug` (tenant slug) and `--image-tag` arguments
- [ ] Stop the existing container for the tenant
- [ ] Pull the new image
- [ ] Start a new container with identical volume mounts and env vars (read from provisioner state or `deployment_state.json`)
- [ ] Poll `/readyz` with timeout (60s, matching provisioner behavior from P1-2)
- [ ] On success: remove old container, log result
- [ ] On failure: stop new container, restart old container (rollback), log failure, return non-zero exit code
- [ ] Support `--dry-run` flag to show what would happen without executing

---

### Task P2-3: Admin bot update commands

**Blueprint ref:** §4.3, §4.4, §4.6

**Context:** Admin Telegram bot commands for managing the update pipeline. All commands execute via the provisioner API — the bot does not run ops scripts directly.

- [ ] `/update status` — Show current TC version, OC version, image tag, canary status, rollout stage
- [ ] `/update build [oc-version]` — Trigger `ops/build.sh` on server, report result
- [ ] `/update canary start` — Deploy new image to canary group (5 tenants), start 24h monitoring window
- [ ] `/update canary advance` — Advance to next rollout stage (10% → 25% → 50% → 100%) with confirmation
- [ ] `/update fleet` — Advance rollout to 100% immediately (requires confirmation)
- [ ] `/update rollback` — Roll back to previous image tag at current rollout stage
- [ ] `/update canary set [slug,slug,slug,slug,slug]` — Set the 5 tenants in the canary group
- [ ] Wire all commands through provisioner API endpoints (not direct script execution)
- [ ] Command handler file: `ops/admin-bot/commands/update.ts`

---

### Task P2-4: `deployment_state.json`

**Blueprint ref:** B4.3, §4.2

**Context:** Central state file tracking both Tiger Claw and OpenClaw versions, the active image tag, canary group membership, rollout stage, and failure counts. Read by `ops/update.sh`, admin bot, and provisioner.

- [ ] Define schema matching Blueprint B4.3: `tigerClaw.current/previous`, `openClaw.current/previous`, `imageTag`, `canary.group/startedAt/stage`, `rollout.stage/percentage/startedAt`
- [ ] Add `failures` tracking: per-container failure count, consecutive failure counter for auto-rollback
- [ ] Add `rollback` state: `rolledBackAt`, `rolledBackFrom`, `rolledBackTo`
- [ ] `ops/build.sh` updates `deployment_state.json` after successful build
- [ ] `ops/update.sh` updates `deployment_state.json` after each container replace (success or failure)
- [ ] File location: server-level (not per-container) — e.g., `/app/data/deployment_state.json`
- [ ] Add read/write helpers with file locking to prevent concurrent update races

---

### Task P2-5: Canary group management

**Blueprint ref:** §4.4, B4.1

**Context:** 5-tenant canary group with staged rollout. Canary deploys first, soaks for 24h minimum, then advances through percentage stages. Auto-rollback on 3 consecutive failures at any stage.

- [ ] Canary group stored in `deployment_state.json` (5 tenant slugs)
- [ ] `/update canary start` deploys to canary group only: pause flywheel → pull image → recreate container → health check → resume flywheel
- [ ] 24h soak minimum before advancing past canary stage
- [ ] Rollout stages after canary: 10% → 25% → 50% → 100% of fleet (each with 6h soak)
- [ ] Auto-advance: if zero failures after soak period, notify admin and wait for manual advance
- [ ] Auto-rollback: if 3 consecutive container failures at any stage, roll back all containers at that stage to previous image
- [ ] Admin notification on: canary complete, stage advance, failure, rollback
- [ ] Validate SecretRef end-to-end during first canary deployment (P1 carry-forward)

---

## Definition of Phase 2 Complete

Phase 2 is complete when ALL of the following are true:

- [ ] `ops/build.sh` produces correctly tagged images and pushes to registry (P2-1)
- [ ] `ops/update.sh` replaces a single tenant container with rollback on failure (P2-2)
- [ ] Admin bot `/update` commands are functional and wired to provisioner API (P2-3)
- [ ] `deployment_state.json` tracks versions, canary state, and failures (P2-4)
- [ ] Canary group deploys, soaks, and advances/rolls back correctly (P2-5)
- [ ] All changes committed to GitHub
