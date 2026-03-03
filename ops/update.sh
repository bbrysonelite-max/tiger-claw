#!/bin/bash
# Tiger Claw — Single-Tenant Container Update with Rollback
# TIGERCLAW-BLUEPRINT-v3.md §4.4 "Update Flow"
#
# Replaces a tenant's container with a new image. On /readyz failure, rolls
# back to the previous container automatically.
#
# Flow:
#   1. Rename running container to tiger-claw-{slug}-old
#   2. Start new container with same port, volumes, env vars, new image
#   3. Poll /readyz for 60s (matching provisioner.ts behavior)
#   4. Success → remove old container, update deployment_state.json
#   5. Failure → remove new container, rename old back, restart, exit 1
#
# Usage:
#   ./ops/update.sh --slug acme-corp --image-tag ghcr.io/bbrysonelite-max/tiger-claw:v2026.03.03.1-oc2026.3.2
#   ./ops/update.sh --slug acme-corp --image-tag ghcr.io/...tag --no-pull
#   ./ops/update.sh --slug acme-corp --image-tag ghcr.io/...tag --dry-run
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
[[ -f "$REPO_ROOT/.env.deploy" ]] && source "$REPO_ROOT/.env.deploy"

DEPLOYMENT_STATE_FILE="${DEPLOYMENT_STATE_FILE:-$REPO_ROOT/deployment_state.json}"
READYZ_TIMEOUT=60
READYZ_INTERVAL=2
OPENCLAW_PORT=18789

# ── Args ──────────────────────────────────────────────────────────────────────
SLUG=""
IMAGE_TAG=""
DRY_RUN=false
DO_PULL=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --slug)      SLUG="$2";      shift 2 ;;
    --image-tag) IMAGE_TAG="$2"; shift 2 ;;
    --dry-run)   DRY_RUN=true;   shift ;;
    --no-pull)   DO_PULL=false;  shift ;;
    *) echo "[update] ERROR: Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$SLUG" ]]; then
  echo "[update] ERROR: --slug is required." >&2
  echo "  Example: ./ops/update.sh --slug acme-corp --image-tag ghcr.io/bbrysonelite-max/tiger-claw:v2026.03.03.1-oc2026.3.2" >&2
  exit 1
fi

if [[ -z "$IMAGE_TAG" ]]; then
  echo "[update] ERROR: --image-tag is required." >&2
  echo "  Example: ./ops/update.sh --slug acme-corp --image-tag ghcr.io/bbrysonelite-max/tiger-claw:v2026.03.03.1-oc2026.3.2" >&2
  exit 1
fi

CONTAINER="tiger-claw-${SLUG}"
CONTAINER_OLD="${CONTAINER}-old"

log()  { echo "[update] $(date '+%Y-%m-%d %H:%M:%S') $*"; }
error(){ echo "[update] ERROR: $*" >&2; exit 1; }

# ── Resolve running container state via docker inspect ────────────────────────
resolve_container_state() {
  local inspect_json
  inspect_json="$(docker inspect "$CONTAINER" 2>/dev/null)" || error "Container '${CONTAINER}' not found."

  # Host port: find the host port mapped to OPENCLAW_PORT
  HOST_PORT="$(echo "$inspect_json" | python3 -c "
import json, sys
data = json.load(sys.stdin)[0]
bindings = data.get('HostConfig', {}).get('PortBindings', {})
key = '${OPENCLAW_PORT}/tcp'
if key in bindings and bindings[key]:
    print(bindings[key][0].get('HostPort', ''))
else:
    print('')
")"
  [[ -n "$HOST_PORT" ]] || error "Could not resolve host port for ${CONTAINER}."

  # Volume binds: full bind mount strings (e.g., /home/ubuntu/customers/acme/data:/app/data)
  VOLUME_BINDS="$(echo "$inspect_json" | python3 -c "
import json, sys
data = json.load(sys.stdin)[0]
binds = data.get('HostConfig', {}).get('Binds', [])
for b in binds:
    print(b)
")"

  # Env vars: all environment variables from the running container
  ENV_VARS="$(echo "$inspect_json" | python3 -c "
import json, sys
data = json.load(sys.stdin)[0]
env_list = data.get('Config', {}).get('Env', [])
# Filter out runtime-generated vars that Docker injects
skip_prefixes = ('PATH=', 'HOSTNAME=', 'HOME=', 'TERM=')
for e in env_list:
    if not any(e.startswith(p) for p in skip_prefixes):
        print(e)
")"

  # Extra hosts (e.g., host.docker.internal:host-gateway)
  EXTRA_HOSTS="$(echo "$inspect_json" | python3 -c "
import json, sys
data = json.load(sys.stdin)[0]
hosts = data.get('HostConfig', {}).get('ExtraHosts', [])
for h in hosts:
    print(h)
")"

  # Restart policy
  RESTART_POLICY="$(echo "$inspect_json" | python3 -c "
import json, sys
data = json.load(sys.stdin)[0]
policy = data.get('HostConfig', {}).get('RestartPolicy', {}).get('Name', 'unless-stopped')
print(policy)
")"
}

# ── Build docker run arguments from resolved state ────────────────────────────
build_run_args() {
  RUN_ARGS=(
    "--name" "$CONTAINER"
    "-d"
    "--restart" "${RESTART_POLICY:-unless-stopped}"
    "-p" "${HOST_PORT}:${OPENCLAW_PORT}"
  )

  # Volume binds
  while IFS= read -r bind; do
    [[ -n "$bind" ]] && RUN_ARGS+=("-v" "$bind")
  done <<< "$VOLUME_BINDS"

  # Env vars
  while IFS= read -r evar; do
    [[ -n "$evar" ]] && RUN_ARGS+=("-e" "$evar")
  done <<< "$ENV_VARS"

  # Extra hosts
  while IFS= read -r host; do
    [[ -n "$host" ]] && RUN_ARGS+=("--add-host" "$host")
  done <<< "$EXTRA_HOSTS"

  RUN_ARGS+=("$IMAGE_TAG")
}

# ── Poll /readyz ──────────────────────────────────────────────────────────────
poll_readyz() {
  local port="$1" timeout="$2" interval="$3"
  local deadline=$((SECONDS + timeout))
  local attempt=0

  while (( SECONDS < deadline )); do
    attempt=$((attempt + 1))
    local status
    status="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${port}/readyz" 2>/dev/null || echo "000")"
    if [[ "$status" == "200" ]]; then
      log "/readyz passed on attempt ${attempt} (HTTP ${status})"
      return 0
    fi
    log "/readyz attempt ${attempt}: HTTP ${status}, retrying in ${interval}s"
    sleep "$interval"
  done

  log "/readyz FAILED after ${attempt} attempts (${timeout}s timeout)"
  return 1
}

# ── Update deployment_state.json ──────────────────────────────────────────────
update_state() {
  local slug="$1" image_tag="$2" success="$3"

  [[ -f "$DEPLOYMENT_STATE_FILE" ]] || echo '{}' > "$DEPLOYMENT_STATE_FILE"

  python3 - "$slug" "$image_tag" "$success" "$DEPLOYMENT_STATE_FILE" << 'PYEOF'
import json, sys, datetime

slug, image_tag, success, state_file = sys.argv[1:]

try:
    with open(state_file) as f:
        d = json.load(f)
except Exception:
    d = {}

if 'tenants' not in d:
    d['tenants'] = {}

t = d['tenants'].get(slug, {})
now = datetime.datetime.utcnow().isoformat() + 'Z'

if success == 'true':
    t['imageTag'] = image_tag
    t['updatedAt'] = now
    t['successCount'] = t.get('successCount', 0) + 1
    t['consecutiveFailures'] = 0
else:
    t['lastFailedAt'] = now
    t['failureCount'] = t.get('failureCount', 0) + 1
    t['consecutiveFailures'] = t.get('consecutiveFailures', 0) + 1

d['tenants'][slug] = t

with open(state_file, 'w') as f:
    json.dump(d, f, indent=2)
PYEOF
}

# ── Rollback: restore old container ──────────────────────────────────────────
rollback() {
  log "ROLLBACK: restoring previous container..."

  # Stop and remove the failed new container
  docker stop "$CONTAINER" --time 10 2>/dev/null || true
  docker rm -f "$CONTAINER" 2>/dev/null || true

  # Rename old container back
  docker rename "$CONTAINER_OLD" "$CONTAINER" 2>/dev/null || error "Failed to rename ${CONTAINER_OLD} back to ${CONTAINER}."

  # Restart old container
  docker start "$CONTAINER" 2>/dev/null || error "Failed to restart old container ${CONTAINER}."

  # Verify old container is healthy
  log "Verifying old container health..."
  if poll_readyz "$HOST_PORT" 30 2; then
    log "ROLLBACK COMPLETE: old container is healthy."
  else
    log "WARNING: old container restarted but /readyz not passing. Manual intervention required."
  fi

  update_state "$SLUG" "$IMAGE_TAG" "false"
}

# ── Main ──────────────────────────────────────────────────────────────────────
main() {
  log "=== Tiger Claw Container Update ==="
  log "Slug:      ${SLUG}"
  log "Container: ${CONTAINER}"
  log "New image: ${IMAGE_TAG}"

  # 1. Resolve current container state
  log "Resolving container state..."
  resolve_container_state
  log "  Host port: ${HOST_PORT}"
  log "  Volumes:   $(echo "$VOLUME_BINDS" | wc -l | tr -d ' ') bind(s)"
  log "  Env vars:  $(echo "$ENV_VARS" | wc -l | tr -d ' ') variable(s)"

  build_run_args

  # Dry-run: print plan and exit
  if [[ "$DRY_RUN" == "true" ]]; then
    log "[dry-run] Would pull image: ${IMAGE_TAG}"
    log "[dry-run] Would rename ${CONTAINER} → ${CONTAINER_OLD}"
    log "[dry-run] Would run: docker run ${RUN_ARGS[*]}"
    log "[dry-run] Would poll /readyz on port ${HOST_PORT} for ${READYZ_TIMEOUT}s"
    log "[dry-run] On success: remove ${CONTAINER_OLD}"
    log "[dry-run] On failure: rollback to ${CONTAINER_OLD}"
    exit 0
  fi

  # 2. Pull new image
  if [[ "$DO_PULL" == "true" ]]; then
    if [[ -z "${GITHUB_TOKEN:-}" ]]; then
      error "GITHUB_TOKEN env var is not set. Required for GHCR pull."
    fi
    log "Pulling image: ${IMAGE_TAG}"
    docker pull "$IMAGE_TAG" || error "Failed to pull ${IMAGE_TAG}."
  else
    log "Skipping pull (--no-pull)."
  fi

  # 3. Stop the running container and rename it (keep it for rollback)
  log "Stopping container ${CONTAINER}..."
  docker stop "$CONTAINER" --time 10 || error "Failed to stop ${CONTAINER}."

  log "Renaming ${CONTAINER} → ${CONTAINER_OLD}"
  docker rename "$CONTAINER" "$CONTAINER_OLD" || error "Failed to rename ${CONTAINER} to ${CONTAINER_OLD}."

  # 4. Start new container
  log "Starting new container..."
  if ! docker run "${RUN_ARGS[@]}"; then
    log "Failed to start new container. Rolling back..."
    rollback
    exit 1
  fi
  log "New container started."

  # 5. Poll /readyz
  log "Polling /readyz on port ${HOST_PORT} (timeout: ${READYZ_TIMEOUT}s)..."
  if poll_readyz "$HOST_PORT" "$READYZ_TIMEOUT" "$READYZ_INTERVAL"; then
    # Success: remove old container
    log "Readiness confirmed. Removing old container..."
    docker rm -f "$CONTAINER_OLD" 2>/dev/null || true
    update_state "$SLUG" "$IMAGE_TAG" "true"
    log ""
    log "Update complete."
    log "  Slug:  ${SLUG}"
    log "  Image: ${IMAGE_TAG}"
    log "  Port:  ${HOST_PORT}"
    exit 0
  else
    # Failure: rollback
    log "/readyz FAILED. Initiating rollback..."
    rollback
    log ""
    log "UPDATE FAILED: ${SLUG} rolled back to previous image."
    exit 1
  fi
}

main
