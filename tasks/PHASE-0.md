# Phase 0 — Build Unblocked

**Status:** ACTIVE — this is the current work phase
**Prerequisite for:** Everything else. No Phase 1, 2, 3 work until Phase 0 is verified complete.
**Completion signal:** A working Docker container starts, OpenClaw gateway initializes, `/readyz` returns 200.

---

## Context

`docker/customer/Dockerfile` currently contains:
```dockerfile
RUN npm install -g @openclaw/openclaw@0.1.0
```

This package/version does not exist on npm. The current OpenClaw release is `v2026.3.2`. The entire container build is blocked until the correct install command is found and verified.

**OpenClaw GitHub:** https://github.com/openclaw/openclaw

---

## Task List

### Task P0-1: Find the correct OpenClaw install command

**What to do:**
1. Read the OpenClaw README at https://github.com/openclaw/openclaw — specifically the "Installation" or "Getting Started" section
2. Find the exact `npm install` command for a production/headless install
3. Confirm whether the package is `@openclaw/openclaw`, `openclaw`, or something else
4. Confirm the version tag format (is it `2026.3.2` or `v2026.3.2` or something else on npm)
5. Check if OpenClaw requires any system dependencies (e.g., specific Node version, native modules)

**Expected output:** The verified install command, e.g.:
```
npm install -g openclaw@2026.3.2
```

**Do not modify any files during this task.** Just find and confirm the command.

---

### Task P0-2: Update `docker/customer/Dockerfile`

**Depends on:** P0-1 complete

**File to edit:** `docker/customer/Dockerfile`

**Current state:**
```dockerfile
RUN npm install -g @openclaw/openclaw@0.1.0
```

**Required changes:**
1. Replace the install command with the verified command from P0-1
2. Make the OpenClaw version a build ARG so `ops/build.sh` can parameterize it:
```dockerfile
ARG OPENCLAW_VERSION=2026.3.2
RUN npm install -g openclaw@${OPENCLAW_VERSION}
```
3. Add a build ARG for Tiger Claw version:
```dockerfile
ARG TC_VERSION=dev
LABEL tc.version="${TC_VERSION}" oc.version="${OPENCLAW_VERSION}"
```
4. Verify Node version in base image is compatible with OpenClaw's requirements (check OpenClaw docs). Current base is `node:22-slim`.
5. Add any required system dependencies (e.g., if OpenClaw needs `python3`, `build-essential`, etc.)

**Do not change anything else in the Dockerfile during this task.**

---

### Task P0-3: Verify container starts successfully

**Depends on:** P0-2 complete

**What to do:**
1. Build the image locally:
```bash
docker build -t tiger-claw:test --build-arg OPENCLAW_VERSION=2026.3.2 docker/customer/
```
2. Run it with minimal env vars to confirm OpenClaw starts:
```bash
docker run --rm -e TENANT_SLUG=test -e TC_PORT=18789 tiger-claw:test
```
3. Check that OpenClaw gateway initializes without errors
4. Confirm `/readyz` returns 200:
```bash
curl http://localhost:18789/readyz
```
5. If it fails, document the error and fix it before proceeding

**Success criteria:**
- `docker build` completes without error
- `docker run` starts without immediate crash
- OpenClaw gateway log shows successful initialization
- `curl http://localhost:18789/readyz` returns HTTP 200

---

### Task P0-4: Update `provisioner.ts` to use `/readyz`

**Depends on:** P0-3 confirmed working

**File to edit:** `api/src/services/provisioner.ts`

**What to change:**
Find the health check polling loop in the provisioning flow (currently polls `/health`). Change the endpoint from `/health` to `/readyz`.

The change is intentional and documented in `docs/adr/0008-readyz-for-provisioning.md`. `/readyz` only returns 200 when the OpenClaw gateway is fully initialized and ready to accept messages. `/health` returns 200 as soon as the process is alive — too early for provisioning purposes.

**Verify:** A test provisioning flow confirms the container is not marked as "onboarding" until `/readyz` returns 200.

---

### Task P0-5: Confirm `entrypoint.sh` generates valid config for current OpenClaw version

**Depends on:** P0-3 confirmed working

**File to review:** `docker/customer/entrypoint.sh`

**What to do:**
1. Read the full `entrypoint.sh`
2. Compare the generated `openclaw.json` structure against the OpenClaw v2026.3.2 config schema (see `specs/openclaw/` docs)
3. Identify any config keys that have been renamed, removed, or restructured in v2026.3.2
4. Verify the Telegram channel config block is valid
5. Add these two explicit overrides if not already present:
   - `channels.telegram.streaming: "off"` (LOCKED — see ADR-0009)
   - `agents.defaults.think: "low"` (LOCKED — see ADR-0010)

**Do not change any business logic in `entrypoint.sh`. Only config structure/key corrections.**

---

## Definition of Phase 0 Complete

Phase 0 is complete when ALL of the following are true:

- [ ] The correct OpenClaw npm install command is documented in this file (update P0-1 with findings)
- [ ] `docker/customer/Dockerfile` builds without error using the correct install command
- [ ] A test container starts and `/readyz` returns 200
- [ ] `provisioner.ts` polls `/readyz` for readiness
- [ ] `entrypoint.sh` generates valid config with explicit `streaming: "off"` and `think: "low"`
- [ ] All findings are committed to GitHub with message: `phase 0 complete: verified openclaw install, container build, readyz`

---

## P0-1 Findings

**Verified install command:**
```
npm install -g openclaw@2026.3.2
```

**Package name:** `openclaw` (NOT `@openclaw/openclaw` — the scoped package does not exist)

**Version format on npm:** `2026.3.2` (no `v` prefix). Git tags use `v2026.3.2` but npm uses `2026.3.2`. The `latest` dist-tag points to `2026.3.2` as of 2026-03-03.

**System dependencies required:**
- At least 2 GB RAM during `npm install` (OpenClaw docs warn that `pnpm install` may be OOM-killed on 1 GB hosts with exit 137 — same applies to npm)
- OpenClaw's own Docker image uses `node:22-bookworm` (full Debian), not `node:22-slim`. This matters because some native modules may need build tools. Our current Dockerfile uses `node:22-slim` — may need to switch to `node:22-bookworm` or add `build-essential` if the install fails.

**Node version minimum:** Node >= 22 (stated in both the npm README "Install" section and the "Quick start" section)

**Notes:**
- The existing Dockerfile line `RUN npm install -g @openclaw/openclaw@0.1.0` has TWO errors: wrong package name (`@openclaw/openclaw` should be `openclaw`) and wrong version (`0.1.0` should be `2026.3.2`).
- OpenClaw's default gateway port is `18789`, which matches our `TC_PORT` and `CLAUDE.md`.
- IMPORTANT for P0-5: In v2026.3.2, `channels.telegram.streaming` now defaults to `partial` (changed from `off`). Our LOCKED decision #11 requires `streaming: "off"`, so the explicit override in `entrypoint.sh` is critical — without it, new installs would get live streaming enabled.
- Pre-built Docker images are available at `ghcr.io/openclaw/openclaw:2026.3.2` if we ever want to base our container on the official image instead of installing from npm. Current architecture (install from npm into our own image) is fine.
- Alternative install methods: `pnpm add -g openclaw@2026.3.2` also works. `bun` is supported too.
- OpenClaw uses Telegram via grammY library (confirmed in docs).
- SecretRef support was significantly expanded in v2026.3.2 (64 targets total) — relevant for our LOCKED decision #13 about using SecretRef for key rotation.

**Sources:**
- npm: https://www.npmjs.com/package/openclaw (version `2026.3.2`, 1.5M weekly downloads)
- GitHub releases: https://github.com/openclaw/openclaw/releases/tag/v2026.3.2
- Docker docs: https://docs.openclaw.ai/install/docker
- Install section of README: "Runtime: Node ≥22. `npm install -g openclaw@latest`"
