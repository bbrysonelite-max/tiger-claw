#!/bin/bash
# Tiger Claw Deployment Pipeline — True Blue-Green Edition
# TIGERCLAW-MASTER-SPEC-v2.md Block 1.6, Block 6.4
#
# Blue-green architecture per tenant:
#   Blue slot:  host port {tenant_port + BLUE_OFFSET}  container: tiger-claw-{slug}-blue
#   Green slot: host port {tenant_port + GREEN_OFFSET} container: tiger-claw-{slug}-green
#   Nginx listens on {tenant_port}, proxies to active slot.
#
# Per-container update flow:
#   1. Start new container on the INACTIVE slot port
#   2. Health check every 10s for 60s — all checks must pass
#   3. Atomic Nginx upstream swap → nginx reload
#   4. Record in pendingFinalize (pipeline-advance.sh monitors for 60 min)
#   5. After 60 min healthy: pipeline-advance.sh kills the old slot container
#   6. If unhealthy at any point: swap Nginx back, kill new container
#
# Pipeline stages (automated by pipeline-advance.sh cron every 30 min):
#   build → staging → canary (24h soak) →
#   rolling_10 → rolling_25 → rolling_50 → rolling_100 (6h soak each) → stable
#
# Canary tenants must be designated via /canary add [slug] admin command.
# deploy.sh canary reads the canary list from the Tiger Claw API.
#
# Usage:
#   ./ops/deploy.sh build v2.1.0
#   ./ops/deploy.sh staging v2.1.0
#   ./ops/deploy.sh canary v2.1.0
#   ./ops/deploy.sh rollout v2.1.0 10|25|50|100
#   ./ops/deploy.sh rollback v2.1.0
#   ./ops/deploy.sh status
#   ./ops/deploy.sh finalize               (called by pipeline-advance.sh)
#
# State file: $DEPLOY_STATE_FILE (read/written by pipeline-advance.sh)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
[[ -f "$SCRIPT_DIR/../.env.deploy" ]] && source "$SCRIPT_DIR/../.env.deploy"

# ── Configuration ─────────────────────────────────────────────────────────────
CUSTOMERS_DIR="${CUSTOMERS_DIR:-/home/ubuntu/customers}"
IMAGE_NAME="${IMAGE_NAME:-tiger-claw-scout}"
REGISTRY="${REGISTRY:-}"
TIGER_CLAW_API_URL="${TIGER_CLAW_API_URL:-http://localhost:4000}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"
DEPLOY_STATE_FILE="${DEPLOY_STATE_FILE:-/home/ubuntu/tiger-claw/deploy-state.json}"
NGINX_CONF_DIR="${NGINX_CONF_DIR:-/etc/nginx/conf.d}"

# Port offsets for blue/green slots (relative to tenant's external port)
# Tenant external port: e.g., 18801 (what Nginx listens on)
# Blue slot internal:  18801 + 10000 = 28801  (container binds this on host)
# Green slot internal: 18801 + 20000 = 38801  (container binds this on host)
BLUE_OFFSET=10000
GREEN_OFFSET=20000

# Pre-swap health check: check every 10s for 60s; all 6 must pass
HEALTH_PRE_SWAP_SECS=60
HEALTH_CHECK_INTERVAL_SECS=10

# Image retention
OLD_IMAGES_RETAIN_DAYS=30

log()   { echo "[deploy] $(date '+%Y-%m-%d %H:%M:%S') $*"; }
warn()  { echo "[deploy] WARN: $*" >&2; }
error() { echo "[deploy] ERROR: $*" >&2; exit 1; }

# ── Port math ──────────────────────────────────────────────────────────────────
blue_port()  { echo $(( $1 + BLUE_OFFSET )); }
green_port() { echo $(( $1 + GREEN_OFFSET )); }

# ── State management ───────────────────────────────────────────────────────────
read_state() {
  [[ -f "$DEPLOY_STATE_FILE" ]] && cat "$DEPLOY_STATE_FILE" || echo '{}'
}

write_state() {
  echo "$1" > "$DEPLOY_STATE_FILE"
}

# Update a single top-level string field in state
set_state_field() {
  local key="$1" value="$2"
  local current; current="$(read_state)"
  python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
d['$key'] = '$value'
print(json.dumps(d, indent=2))
" <<< "$current" > "$DEPLOY_STATE_FILE"
}

get_state_field() {
  python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
print(d.get('$1', ''))
" <<< "$(read_state)"
}

transition_stage() {
  local new_stage="$1" version="$2"
  python3 - "$new_stage" "$version" "$DEPLOY_STATE_FILE" << 'PYEOF'
import json, sys, datetime
new_stage, version, state_file = sys.argv[1:]
try:
    with open(state_file) as f:
        d = json.load(f)
except Exception:
    d = {}

prev_stage = d.get('stage', '')
if 'history' not in d:
    d['history'] = []
if prev_stage:
    d['history'].append({
        'stage': prev_stage,
        'completedAt': datetime.datetime.utcnow().isoformat() + 'Z',
        'success': True
    })

d['stage'] = new_stage
d['stageStartedAt'] = datetime.datetime.utcnow().isoformat() + 'Z'
d['targetVersion'] = version
d['status'] = 'soaking'
d['autoAdvance'] = d.get('autoAdvance', True)

with open(state_file, 'w') as f:
    json.dump(d, f, indent=2)
print(new_stage)
PYEOF
  log "Stage → $new_stage"
}

# Add a tenant to the pendingFinalize list (awaiting 60-min post-swap monitoring)
add_pending_finalize() {
  local slug="$1" tenant_port="$2" new_port="$3" old_port="$4" version="$5"
  python3 - "$slug" "$tenant_port" "$new_port" "$old_port" "$version" "$DEPLOY_STATE_FILE" << 'PYEOF'
import json, sys, datetime
slug, tenant_port, new_port, old_port, version, state_file = sys.argv[1:]
try:
    with open(state_file) as f:
        d = json.load(f)
except Exception:
    d = {}

if 'pendingFinalize' not in d:
    d['pendingFinalize'] = []

# Remove any existing entry for this slug
d['pendingFinalize'] = [e for e in d['pendingFinalize'] if e.get('slug') != slug]
d['pendingFinalize'].append({
    'slug': slug,
    'tenantPort': int(tenant_port),
    'newPort': int(new_port),
    'oldPort': int(old_port),
    'version': version,
    'swappedAt': datetime.datetime.utcnow().isoformat() + 'Z'
})

with open(state_file, 'w') as f:
    json.dump(d, f, indent=2)
PYEOF
}

# Add a slug to the updatedTenants list for stage tracking
add_updated_tenant() {
  local slug="$1"
  python3 - "$slug" "$DEPLOY_STATE_FILE" << 'PYEOF'
import json, sys
slug, state_file = sys.argv[1:]
try:
    with open(state_file) as f:
        d = json.load(f)
except Exception:
    d = {}
if 'updatedTenants' not in d:
    d['updatedTenants'] = []
if slug not in d['updatedTenants']:
    d['updatedTenants'].append(slug)
with open(state_file, 'w') as f:
    json.dump(d, f, indent=2)
PYEOF
}

# ── API helpers ────────────────────────────────────────────────────────────────
api_get() {
  curl -sf -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    "${TIGER_CLAW_API_URL}${1}" 2>/dev/null || echo '{}'
}

# ── Nginx helpers ──────────────────────────────────────────────────────────────
nginx_conf_path() {
  echo "${NGINX_CONF_DIR}/tc-${1}.conf"
}

# Write per-tenant Nginx config: Nginx listens on tenant_port, proxies to active_port
nginx_write_config() {
  local slug="$1" tenant_port="$2" active_port="$3"
  local conf; conf="$(nginx_conf_path "$slug")"
  mkdir -p "$NGINX_CONF_DIR"
  cat > "$conf" << NGINX
# Tiger Claw tenant: ${slug}
# Managed by ops/deploy.sh — do NOT edit manually
# External port ${tenant_port} → internal slot port ${active_port}

upstream tc_${slug} {
    server 127.0.0.1:${active_port};
    keepalive 4;
}

server {
    listen ${tenant_port};
    server_name _;

    location / {
        proxy_pass         http://tc_${slug};
        proxy_http_version 1.1;
        proxy_set_header   Connection "";
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_connect_timeout 10s;
        proxy_send_timeout    60s;
        proxy_read_timeout    60s;
    }
}
NGINX
  log "  Nginx config → $(nginx_conf_path "$slug") (${tenant_port} → ${active_port})"
}

# Read the active internal port from an existing Nginx config
nginx_get_active_port() {
  local conf; conf="$(nginx_conf_path "$1")"
  [[ -f "$conf" ]] && grep -oP 'server 127\.0\.0\.1:\K[0-9]+' "$conf" | head -1 || echo ""
}

nginx_reload() {
  if nginx -t 2>/dev/null; then
    nginx -s reload
    sleep 1
    return 0
  else
    warn "Nginx config test failed — NOT reloading"
    return 1
  fi
}

# ── Container helpers ──────────────────────────────────────────────────────────
container_health() {
  local port="$1"
  curl -sf --max-time 5 "http://127.0.0.1:${port}/health" >/dev/null 2>&1
}

# Detect which slot (blue/green) is currently active based on Nginx config
active_slot() {
  local slug="$1" tenant_port="$2"
  local active_nginx_port; active_nginx_port="$(nginx_get_active_port "$slug")"
  local bp; bp="$(blue_port "$tenant_port")"
  [[ "$active_nginx_port" == "$bp" ]] && echo "blue" || echo "green"
}

# Generate a temporary docker-compose override for the new container slot
write_slot_compose() {
  local slug="$1" version="$2" slot_port="$3" container_name="$4"
  local src="${CUSTOMERS_DIR}/${slug}/docker-compose.yml"
  local dst="${CUSTOMERS_DIR}/${slug}/docker-compose.update.yml"

  [[ ! -f "$src" ]] && { log "  ERROR: No compose file at $src"; return 1; }

  python3 - "$slug" "$IMAGE_NAME" "$version" "$slot_port" "$container_name" "$src" "$dst" << 'PYEOF'
import re, sys
slug, image_name, version, slot_port, container_name, src, dst = sys.argv[1:]

with open(src) as f:
    content = f.read()

# Update service name to the new container name (remove 'tiger-claw-{slug}' prefix)
# The service key in the yaml is what docker compose uses as a service label
content = re.sub(r'(^|\n)  tiger-claw-' + re.escape(slug) + r'(\s*:)',
                 r'\1  ' + container_name + r'\2',
                 content)

# Update container_name field
content = re.sub(r'container_name:\s*tiger-claw-' + re.escape(slug),
                 f'container_name: {container_name}',
                 content)

# Update port mapping (any port:18789 pattern)
content = re.sub(r"ports:\s*\n\s*-\s*['\"]?[0-9]+:18789['\"]?",
                 f"ports:\n      - '{slot_port}:18789'",
                 content)

# Update image version
content = re.sub(r'image:\s*\S+', f'image: {image_name}:{version}', content)

with open(dst, 'w') as f:
    f.write(content)
PYEOF
}

cleanup_update_compose() {
  rm -f "${CUSTOMERS_DIR}/${1}/docker-compose.update.yml"
}

# ── First-time migration: ensure a tenant is managed by Nginx ──────────────────
# Existing tenants run with docker port mapping directly on their external port.
# This function migrates them to the Nginx-managed architecture (one-time, ~5s downtime).
ensure_nginx_managed() {
  local slug="$1" tenant_port="$2"
  local conf; conf="$(nginx_conf_path "$slug")"

  if [[ -f "$conf" ]]; then
    return 0  # Already Nginx-managed
  fi

  log "  First-time Nginx migration for ${slug} (port ${tenant_port})..."
  log "  This is a one-time operation with ~5s downtime."

  local bp; bp="$(blue_port "$tenant_port")"
  local old_container="tiger-claw-${slug}"
  local blue_container="tiger-claw-${slug}-blue"
  local compose="${CUSTOMERS_DIR}/${slug}/docker-compose.yml"

  # Step 1: Stop existing container
  docker stop "$old_container" 2>/dev/null || true
  docker rm "$old_container" 2>/dev/null || true

  # Step 2: Rewrite compose to use blue slot port and blue container name
  if [[ -f "$compose" ]]; then
    python3 - "$slug" "$bp" "$blue_container" "$compose" << 'PYEOF'
import re, sys
slug, bp, blue_name, compose_file = sys.argv[1:]

with open(compose_file) as f:
    content = f.read()

content = re.sub(r'(^|\n)  tiger-claw-' + re.escape(slug) + r'(\s*:)',
                 r'\1  ' + blue_name + r'\2',
                 content)
content = re.sub(r'container_name:\s*tiger-claw-' + re.escape(slug),
                 f'container_name: {blue_name}',
                 content)
content = re.sub(r"ports:\s*\n\s*-\s*['\"]?[0-9]+:18789['\"]?",
                 f"ports:\n      - '{bp}:18789'",
                 content)

with open(compose_file, 'w') as f:
    f.write(content)
PYEOF
  fi

  # Step 3: Start container on blue slot port
  cd "${CUSTOMERS_DIR}/${slug}"
  docker compose up -d --quiet-pull 2>/dev/null
  sleep 5

  if ! container_health "$bp"; then
    error "Container ${blue_container} failed health check after migration to port ${bp}"
  fi

  # Step 4: Create Nginx config pointing to blue slot
  nginx_write_config "$slug" "$tenant_port" "$bp"
  nginx_reload

  log "  ✅ ${slug} migrated to Nginx-managed (${tenant_port} → ${bp})"
}

# ── Core blue-green update for a single tenant ────────────────────────────────
# Returns 0 on success (Nginx swapped, old container pending finalize).
# Returns 1 on failure (Nginx not swapped, new container cleaned up).
do_blue_green_update() {
  local slug="$1" version="$2" tenant_port="$3"

  log "Blue-green: ${slug} → ${version} (tenant port ${tenant_port})"

  # Ensure this tenant is Nginx-managed (one-time migration if needed)
  ensure_nginx_managed "$slug" "$tenant_port"

  local bp; bp="$(blue_port "$tenant_port")"
  local gp; gp="$(green_port "$tenant_port")"

  # Determine active and inactive slots
  local active_nginx_port; active_nginx_port="$(nginx_get_active_port "$slug")"
  local new_slot_port old_slot_port new_container_name old_container_name

  if [[ "$active_nginx_port" == "$bp" ]]; then
    # Blue is active → deploy to green slot
    new_slot_port="$gp"
    old_slot_port="$bp"
    new_container_name="tiger-claw-${slug}-green"
    old_container_name="tiger-claw-${slug}-blue"
  else
    # Green is active → deploy to blue slot
    new_slot_port="$bp"
    old_slot_port="$gp"
    new_container_name="tiger-claw-${slug}-blue"
    old_container_name="tiger-claw-${slug}-green"
  fi

  log "  Active slot: port ${old_slot_port} | New container: ${new_container_name} on port ${new_slot_port}"

  # ── Step 1: Start new container on inactive slot ──
  log "  Starting ${new_container_name}..."
  docker stop "$new_container_name" 2>/dev/null || true
  docker rm   "$new_container_name" 2>/dev/null || true

  write_slot_compose "$slug" "$version" "$new_slot_port" "$new_container_name"
  if ! docker compose -f "${CUSTOMERS_DIR}/${slug}/docker-compose.update.yml" up -d --quiet-pull 2>/dev/null; then
    log "  ERROR: docker compose up failed for ${new_container_name}"
    cleanup_update_compose "$slug"
    return 1
  fi
  cleanup_update_compose "$slug"

  # ── Step 2: Pre-swap health check — all checks for 60 seconds must pass ──
  local checks_needed; checks_needed=$(( HEALTH_PRE_SWAP_SECS / HEALTH_CHECK_INTERVAL_SECS ))
  log "  Pre-swap health check: ${checks_needed} checks × ${HEALTH_CHECK_INTERVAL_SECS}s interval..."

  for (( i=1; i<=checks_needed; i++ )); do
    sleep "$HEALTH_CHECK_INTERVAL_SECS"
    if ! container_health "$new_slot_port"; then
      log "  FAIL: Health check ${i}/${checks_needed} failed — aborting blue-green for ${slug}"
      docker stop "$new_container_name" 2>/dev/null || true
      docker rm   "$new_container_name" 2>/dev/null || true
      return 1
    fi
    log "  Health OK ${i}/${checks_needed}"
  done

  log "  Pre-swap health check passed (${checks_needed} consecutive successes)"

  # ── Step 3: Atomic Nginx swap ──
  nginx_write_config "$slug" "$tenant_port" "$new_slot_port"
  if ! nginx_reload; then
    log "  ERROR: Nginx reload failed — reverting"
    nginx_write_config "$slug" "$tenant_port" "$old_slot_port"
    nginx_reload || true
    docker stop "$new_container_name" 2>/dev/null || true
    docker rm   "$new_container_name" 2>/dev/null || true
    return 1
  fi

  log "  ✅ Nginx swapped: ${tenant_port} → ${new_slot_port} (${new_container_name})"
  log "  Old container (port ${old_slot_port}) still running. Finalize after 60-min soak."

  # ── Step 4: Record pending finalize for 60-min post-swap monitoring ──
  add_pending_finalize "$slug" "$tenant_port" "$new_slot_port" "$old_slot_port" "$version"
  add_updated_tenant "$slug"

  return 0
}

# ── Stage 1: Build ─────────────────────────────────────────────────────────────
do_build() {
  local version="$1"
  [[ -z "$version" ]] && error "version required: deploy.sh build v2.1.0"

  log "Building ${IMAGE_NAME}:${version}..."
  docker build -t "${IMAGE_NAME}:${version}" -t "${IMAGE_NAME}:latest" "$(dirname "$SCRIPT_DIR")"

  if [[ -n "$REGISTRY" ]]; then
    docker tag "${IMAGE_NAME}:${version}" "${REGISTRY}/${IMAGE_NAME}:${version}"
    docker push "${REGISTRY}/${IMAGE_NAME}:${version}"
    log "Pushed to registry: ${REGISTRY}/${IMAGE_NAME}:${version}"
  fi

  local prev_version; prev_version="$(get_state_field currentVersion)"
  python3 - "$version" "$prev_version" "$DEPLOY_STATE_FILE" << 'PYEOF'
import json, sys, datetime
version, prev_version, state_file = sys.argv[1:]
try:
    with open(state_file) as f:
        d = json.load(f)
except Exception:
    d = {}
d['previousVersion'] = prev_version or d.get('currentVersion', 'unknown')
d['targetVersion'] = version
d['stage'] = 'built'
d['stageStartedAt'] = datetime.datetime.utcnow().isoformat() + 'Z'
d['status'] = 'ready'
d['updatedTenants'] = []
d['pendingFinalize'] = d.get('pendingFinalize', [])
d['autoAdvance'] = d.get('autoAdvance', True)
with open(state_file, 'w') as f:
    json.dump(d, f, indent=2)
PYEOF

  log "✅ Build complete. Next: ./ops/deploy.sh staging ${version}"
}

# ── Stage 2: Staging ──────────────────────────────────────────────────────────
do_staging() {
  local version="$1"
  [[ -z "$version" ]] && error "version required"

  log "Deploying ${version} to staging containers (tiger-claw-staging-*)..."
  transition_stage "staging" "$version"

  # Staging containers are named tiger-claw-staging-* and sit in $CUSTOMERS_DIR/staging-*/
  local staging_slugs
  staging_slugs="$(docker ps -a --filter name=tiger-claw-staging --format '{{.Names}}' 2>/dev/null \
    | sed 's/^tiger-claw-//' | grep '^staging' || echo "")"

  if [[ -z "$staging_slugs" ]]; then
    log "No staging containers found — skipping (create tiger-claw-staging-* containers to enable)"
    log "✅ Staging skipped. Run: ./ops/deploy.sh canary ${version}"
    set_state_field "status" "staging_skipped"
    return 0
  fi

  local passed=0 failed=0
  while IFS= read -r slug; do
    [[ -z "$slug" ]] && continue
    local port_line; port_line="$(docker inspect "tiger-claw-${slug}" 2>/dev/null \
      | python3 -c "import json,sys; d=json.load(sys.stdin); print(list((d[0].get('NetworkSettings',{}).get('Ports',{})).keys())[0].split('/')[0])" 2>/dev/null || echo "")"
    local tenant_port="${port_line:-0}"

    if [[ "$tenant_port" -gt 0 ]] && do_blue_green_update "$slug" "$version" "$tenant_port"; then
      ((passed++))
    else
      ((failed++))
    fi
  done <<< "$staging_slugs"

  if (( failed > 0 && passed == 0 )); then
    error "Staging failed: all ${failed} containers failed. Not proceeding."
  fi

  log "✅ Staging: ${passed} passed, ${failed} failed."
  set_state_field "status" "soaking"
  log "pipeline-advance.sh will auto-advance to canary when staging is healthy."
  log "Or run manually: ./ops/deploy.sh canary ${version}"
}

# ── Stage 3: Canary ───────────────────────────────────────────────────────────
do_canary() {
  local version="$1"
  [[ -z "$version" ]] && error "version required"

  log "Deploying ${version} to designated canary tenants..."

  # Fetch canary tenant list from API (tenants with canary_group = true)
  local canary_json; canary_json="$(api_get "/admin/canary")"
  local canary_slugs
  canary_slugs="$(echo "$canary_json" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); [print(t['slug']) for t in d.get('tenants',[])]" \
    2>/dev/null || echo "")"

  if [[ -z "$canary_slugs" ]]; then
    error "No designated canary tenants found. Use '/canary add [slug]' in the admin bot to designate tenants."
  fi

  transition_stage "canary" "$version"

  # Store the canary slug list in state
  python3 - "$DEPLOY_STATE_FILE" << PYEOF
import json, sys
state_file = sys.argv[1]
slugs = [$(echo "$canary_slugs" | awk '{printf "\"%s\",",$0}' | sed 's/,$//')]
try:
    with open(state_file) as f:
        d = json.load(f)
except Exception:
    d = {}
d['canaryTenants'] = slugs
with open(state_file, 'w') as f:
    json.dump(d, f, indent=2)
PYEOF

  local passed=0 failed=0
  while IFS= read -r slug; do
    [[ -z "$slug" ]] && continue

    local tenant_port; tenant_port="$(get_tenant_port "$slug")"
    if [[ -z "$tenant_port" ]]; then
      log "  SKIP: could not resolve port for ${slug}"
      continue
    fi

    log "Canary: ${slug} (port ${tenant_port})"
    if do_blue_green_update "$slug" "$version" "$tenant_port"; then
      ((passed++))
    else
      log "  ❌ Blue-green failed for ${slug}"
      ((failed++))
    fi
  done <<< "$canary_slugs"

  log "✅ Canary deployed: ${passed} updated, ${failed} failed"
  log "24-hour soak begins. pipeline-advance.sh will advance automatically."
}

# ── Stage 4: Rolling rollout ──────────────────────────────────────────────────
do_rollout() {
  local version="$1" percent="${2:-10}"
  [[ -z "$version" ]] && error "version required"
  [[ ! "$percent" =~ ^(10|25|50|100)$ ]] && error "percent must be 10, 25, 50, or 100"

  log "Rolling out ${version} to ${percent}% of fleet..."

  local fleet_json; fleet_json="$(api_get "/admin/fleet")"
  local all_slugs
  all_slugs="$(echo "$fleet_json" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); [print(t['slug']) for t in d.get('tenants',[]) if t['status'] in ('active','onboarding')]" \
    2>/dev/null || echo "")"

  local total; total="$(echo "$all_slugs" | grep -c . 2>/dev/null || echo 0)"
  local target; target=$(( (total * percent + 99) / 100 ))
  log "  Fleet: ${total} tenants | Target for ${percent}%: ${target}"

  transition_stage "rolling_${percent}" "$version"

  local updated=0 failed=0 consecutive_failures=0
  while IFS= read -r slug; do
    [[ -z "$slug" ]] && continue
    (( updated + failed >= target )) && break

    local tenant_port; tenant_port="$(get_tenant_port "$slug")"
    if [[ -z "$tenant_port" ]]; then
      log "  SKIP: could not resolve port for ${slug}"
      continue
    fi

    log "Updating: ${slug} (${updated+1}/${target})"
    if do_blue_green_update "$slug" "$version" "$tenant_port"; then
      ((updated++))
      consecutive_failures=0
    else
      ((failed++))
      ((consecutive_failures++))
      # Auto-rollback on 3 consecutive failures (Block 1.6 LOCKED)
      if (( consecutive_failures >= 3 )); then
        log "🚨 3 consecutive failures — triggering auto-rollback"
        do_rollback "$version"
        error "Rollout aborted after 3 consecutive failures."
      fi
    fi
  done <<< "$all_slugs"

  log "✅ Rollout ${percent}%: ${updated} updated, ${failed} skipped/failed"
  if [[ "$percent" != "100" ]]; then
    log "6-hour soak begins. pipeline-advance.sh will advance to $(next_percent "$percent")% automatically."
  else
    log "✅ Full rollout complete."
    set_state_field "stage" "stable"
    set_state_field "status" "stable"
    set_state_field "currentVersion" "$version"
    prune_old_images "$version"
  fi
}

# ── Finalize: kill old containers after 60-min post-swap soak ─────────────────
# Called by pipeline-advance.sh for entries that have soaked long enough.
do_finalize_one() {
  local slug="$1" tenant_port="$2" new_port="$3" old_port="$4"

  # Verify the new container is still healthy
  if ! container_health "$new_port"; then
    log "  ❌ ${slug}: new container (port ${new_port}) failed health check — rolling back"
    nginx_write_config "$slug" "$tenant_port" "$old_port"
    nginx_reload || true

    # Kill the failed new container
    local new_name; new_name="$(port_to_container_name "$slug" "$new_port" "$tenant_port")"
    docker stop "$new_name" 2>/dev/null || true
    docker rm   "$new_name" 2>/dev/null || true

    return 1
  fi

  # New container healthy → kill old container
  local old_name; old_name="$(port_to_container_name "$slug" "$old_port" "$tenant_port")"
  log "  ✅ ${slug}: finalizing — killing old container ${old_name} (port ${old_port})"
  docker stop "$old_name" 2>/dev/null || true
  docker rm   "$old_name" 2>/dev/null || true

  return 0
}

# Helper: resolve container name from port + tenant context
port_to_container_name() {
  local slug="$1" port="$2" tenant_port="$3"
  local bp; bp="$(blue_port "$tenant_port")"
  if [[ "$port" == "$bp" ]]; then
    echo "tiger-claw-${slug}-blue"
  else
    echo "tiger-claw-${slug}-green"
  fi
}

# ── Rollback ─────────────────────────────────────────────────────────────────
do_rollback() {
  local bad_version="$1"
  local prev_version; prev_version="$(get_state_field previousVersion)"
  [[ -z "$prev_version" ]] && error "No previousVersion in state — cannot rollback"

  log "🚨 Rolling back from ${bad_version} to ${prev_version}..."

  # For each tenant with a pendingFinalize entry (mid-transition), revert Nginx
  python3 - "$DEPLOY_STATE_FILE" << 'PYEOF'
import json, sys
state_file = sys.argv[1]
try:
    with open(state_file) as f:
        d = json.load(f)
except Exception:
    d = {}
for entry in d.get('pendingFinalize', []):
    print(f"{entry['slug']} {entry['tenantPort']} {entry['newPort']} {entry['oldPort']}")
PYEOF
  | while read -r slug tenant_port new_port old_port; do
    log "  Reverting Nginx for ${slug}: ${tenant_port} → ${old_port}"
    nginx_write_config "$slug" "$tenant_port" "$old_port"
    local new_name; new_name="$(port_to_container_name "$slug" "$new_port" "$tenant_port")"
    docker stop "$new_name" 2>/dev/null || true
    docker rm   "$new_name" 2>/dev/null || true
  done

  nginx_reload || true

  # For tenants that were already finalized (old container killed), relaunch on old version
  local updated_slugs
  updated_slugs="$(python3 -c "
import json, sys
try:
    d = json.loads(sys.stdin.read())
    print('\n'.join(d.get('updatedTenants', [])))
except: pass
" <<< "$(read_state)")"

  local rolled_back=0
  while IFS= read -r slug; do
    [[ -z "$slug" ]] && continue
    local tenant_port; tenant_port="$(get_tenant_port "$slug")"
    [[ -z "$tenant_port" ]] && continue

    log "  Restoring ${slug} to ${prev_version}..."
    do_blue_green_update "$slug" "$prev_version" "$tenant_port" && ((rolled_back++)) || true
  done <<< "$updated_slugs"

  set_state_field "status" "rollback"
  set_state_field "currentVersion" "$prev_version"
  log "✅ Rollback complete. ${rolled_back} containers restored to ${prev_version}."
}

# ── Status ────────────────────────────────────────────────────────────────────
do_status() {
  echo "=== Tiger Claw Deployment Status ==="
  cat "$DEPLOY_STATE_FILE" 2>/dev/null || echo "No state file found."
}

# ── Helper: get tenant port from API or Docker ────────────────────────────────
get_tenant_port() {
  local slug="$1"
  # Try API first
  local port; port="$(api_get "/admin/fleet/${slug}" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('port',''))" 2>/dev/null || echo "")"
  if [[ -n "$port" ]] && [[ "$port" != "None" ]] && [[ "$port" != "null" ]]; then
    echo "$port"
    return
  fi
  # Fallback: read from Nginx config (external port is what Nginx listens on)
  local conf; conf="$(nginx_conf_path "$slug")"
  if [[ -f "$conf" ]]; then
    grep -oP 'listen \K[0-9]+' "$conf" | head -1
  fi
}

# ── Helper: next rollout percentage ──────────────────────────────────────────
next_percent() {
  case "$1" in
    10) echo 25 ;;
    25) echo 50 ;;
    50) echo 100 ;;
    *)  echo 100 ;;
  esac
}

# ── Helper: prune old Docker images ──────────────────────────────────────────
prune_old_images() {
  log "Pruning images older than ${OLD_IMAGES_RETAIN_DAYS} days..."
  docker image prune -a --force \
    --filter "until=${OLD_IMAGES_RETAIN_DAYS}d" \
    --filter "label=org.opencontainers.image.title=${IMAGE_NAME}" 2>/dev/null || true
}

# ── Main dispatch ─────────────────────────────────────────────────────────────
case "${1:-}" in
  build)    do_build   "${2:-}" ;;
  staging)  do_staging "${2:-}" ;;
  canary)   do_canary  "${2:-}" ;;
  rollout)  do_rollout "${2:-}" "${3:-10}" ;;
  rollback) do_rollback "${2:-}" ;;
  status)   do_status ;;
  *)
    echo "Tiger Claw Blue-Green Deployment Pipeline"
    echo ""
    echo "Usage:"
    echo "  $0 build v2.1.0              — build & push new Docker image"
    echo "  $0 staging v2.1.0            — deploy to staging (tiger-claw-staging-*)"
    echo "  $0 canary v2.1.0             — deploy to /canary designated tenants"
    echo "  $0 rollout v2.1.0 10         — deploy to 10% of fleet (then 25, 50, 100)"
    echo "  $0 rollback v2.1.0           — emergency rollback to previousVersion"
    echo "  $0 status                    — show deploy-state.json"
    echo ""
    echo "Pipeline (pipeline-advance.sh auto-advances with soaks):"
    echo "  build → staging → canary (24h) → 10% → 25% → 50% → 100% → stable"
    echo "  Each rollout step has 6-hour soak. Canary has 24-hour soak."
    echo ""
    echo "Canary group management (via admin bot):"
    echo "  /canary add [slug]    — add tenant to canary group"
    echo "  /canary remove [slug] — remove tenant from canary group"
    exit 1
    ;;
esac
