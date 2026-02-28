#!/bin/bash
# Tiger Claw Automated Pipeline Advance
# TIGERCLAW-MASTER-SPEC-v2.md Block 1.6, Block 6.4
#
# Run as a cron job every 30 minutes on the server:
#   */30 * * * * /home/ubuntu/tiger-claw/ops/pipeline-advance.sh >> /var/log/tc-pipeline.log 2>&1
#
# Responsibilities:
#   1. FINALIZE: Check pendingFinalize entries in deploy-state.json.
#      After 60 minutes of healthy post-Nginx-swap, kill the old container.
#      If unhealthy: revert Nginx, kill new container, record failure.
#
#   2. ADVANCE STAGE: If current stage has soaked long enough AND all updated
#      containers are healthy, automatically call deploy.sh to advance:
#        staging    → canary       (no soak required, advance immediately)
#        canary     → rolling_10   (24-hour soak)
#        rolling_10 → rolling_25   (6-hour soak)
#        rolling_25 → rolling_50   (6-hour soak)
#        rolling_50 → rolling_100  (6-hour soak)
#        rolling_100 → stable      (finalized by deploy.sh rollout itself)
#
# The script is designed to be idempotent and safe to run at any time.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
[[ -f "$SCRIPT_DIR/../.env.deploy" ]] && source "$SCRIPT_DIR/../.env.deploy"

# ── Config ─────────────────────────────────────────────────────────────────────
DEPLOY_STATE_FILE="${DEPLOY_STATE_FILE:-/home/ubuntu/tiger-claw/deploy-state.json}"
DEPLOY_SCRIPT="${DEPLOY_SCRIPT:-$SCRIPT_DIR/deploy.sh}"
NGINX_CONF_DIR="${NGINX_CONF_DIR:-/etc/nginx/conf.d}"
TIGER_CLAW_API_URL="${TIGER_CLAW_API_URL:-http://localhost:4000}"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"

# Soak requirements
CANARY_SOAK_HOURS=24
ROLLING_SOAK_HOURS=6
FINALIZE_SOAK_MINUTES=60

log()  { echo "[pipeline] $(date '+%Y-%m-%d %H:%M:%S') $*"; }
warn() { echo "[pipeline] WARN: $*" >&2; }

# ── Helpers ────────────────────────────────────────────────────────────────────
read_state() {
  [[ -f "$DEPLOY_STATE_FILE" ]] && cat "$DEPLOY_STATE_FILE" || echo '{}'
}

write_state() {
  echo "$1" > "$DEPLOY_STATE_FILE"
}

api_get() {
  curl -sf -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    "${TIGER_CLAW_API_URL}${1}" 2>/dev/null || echo '{}'
}

container_health() {
  curl -sf --max-time 5 "http://127.0.0.1:${1}/health" >/dev/null 2>&1
}

nginx_conf_path() {
  echo "${NGINX_CONF_DIR}/tc-${1}.conf"
}

nginx_write_config() {
  local slug="$1" tenant_port="$2" active_port="$3"
  local conf; conf="$(nginx_conf_path "$slug")"
  cat > "$conf" << NGINX
# Tiger Claw tenant: ${slug} — auto-reverted by pipeline-advance.sh
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
        proxy_connect_timeout 10s;
        proxy_send_timeout    60s;
        proxy_read_timeout    60s;
    }
}
NGINX
}

nginx_reload() {
  nginx -t 2>/dev/null && nginx -s reload && sleep 1
}

# Seconds elapsed since an ISO-8601 timestamp
seconds_since() {
  python3 -c "
import datetime, sys
ts = sys.argv[1]
try:
    t = datetime.datetime.fromisoformat(ts.replace('Z', '+00:00'))
    now = datetime.datetime.now(datetime.timezone.utc)
    print(int((now - t).total_seconds()))
except Exception as e:
    print(0)
" "$1"
}

# ── Phase 1: Finalize pending post-Nginx-swap containers ──────────────────────
# For each entry in pendingFinalize, if 60+ minutes have elapsed and the new
# container is still healthy, kill the old container and remove the entry.
# If unhealthy, revert Nginx to the old container and remove the entry.
run_finalize() {
  local state; state="$(read_state)"
  local entries_count
  entries_count="$(echo "$state" | python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
print(len(d.get('pendingFinalize', [])))
" 2>/dev/null || echo 0)"

  if [[ "$entries_count" -eq 0 ]]; then
    return 0
  fi

  log "Checking ${entries_count} pending finalize entries..."

  # Process each entry, building a new list of still-pending entries
  local new_pending_json="[]"
  local finalized=0 reverted=0

  while IFS=$'\t' read -r slug tenant_port new_port old_port version swapped_at; do
    [[ -z "$slug" ]] && continue

    local elapsed_secs; elapsed_secs="$(seconds_since "$swapped_at")"
    local elapsed_mins; elapsed_mins=$(( elapsed_secs / 60 ))

    log "  ${slug}: ${elapsed_mins}m elapsed since Nginx swap (need ${FINALIZE_SOAK_MINUTES}m)"

    if (( elapsed_mins < FINALIZE_SOAK_MINUTES )); then
      # Still soaking — keep in pending list
      new_pending_json="$(python3 -c "
import json, sys
lst = json.loads(sys.argv[1])
lst.append({'slug':'$slug','tenantPort':$tenant_port,'newPort':$new_port,'oldPort':$old_port,'version':'$version','swappedAt':'$swapped_at'})
print(json.dumps(lst))
" "$new_pending_json")"
      continue
    fi

    # Soak complete — check if new container is still healthy
    if container_health "$new_port"; then
      # Healthy → kill old container
      local old_container
      if (( old_port == tenant_port + 10000 )); then
        old_container="tiger-claw-${slug}-blue"
      else
        old_container="tiger-claw-${slug}-green"
      fi

      log "  ✅ ${slug}: finalized. Killing old container ${old_container} (port ${old_port})"
      docker stop "$old_container" 2>/dev/null || true
      docker rm   "$old_container" 2>/dev/null || true
      ((finalized++))
      # Entry NOT added back to new_pending_json — it's done
    else
      # Unhealthy → revert Nginx back to old container
      warn "${slug}: new container (port ${new_port}) FAILED 60-min health check — reverting"
      nginx_write_config "$slug" "$tenant_port" "$old_port"
      nginx_reload 2>/dev/null || true

      # Kill the failed new container
      local new_container
      if (( new_port == tenant_port + 20000 )); then
        new_container="tiger-claw-${slug}-green"
      else
        new_container="tiger-claw-${slug}-blue"
      fi
      docker stop "$new_container" 2>/dev/null || true
      docker rm   "$new_container" 2>/dev/null || true
      ((reverted++))
      # Entry NOT added back — it's done (failed)

      # Alert admin via Tiger Claw API
      curl -sf -X POST \
        -H "Authorization: Bearer ${ADMIN_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{\"message\":\"🔴 Blue-green revert: ${slug} failed 60-min post-swap health check. Reverted to old container (port ${old_port}).\"}" \
        "${TIGER_CLAW_API_URL}/admin/alerts" 2>/dev/null || true
    fi
  done < <(echo "$state" | python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
for e in d.get('pendingFinalize', []):
    print('\t'.join([
        e.get('slug',''),
        str(e.get('tenantPort',0)),
        str(e.get('newPort',0)),
        str(e.get('oldPort',0)),
        e.get('version',''),
        e.get('swappedAt','')
    ]))
" 2>/dev/null)

  # Write updated state with remaining pending entries
  python3 - "$DEPLOY_STATE_FILE" "$new_pending_json" << 'PYEOF'
import json, sys
state_file, new_pending_json = sys.argv[1:]
try:
    with open(state_file) as f:
        d = json.load(f)
except Exception:
    d = {}
d['pendingFinalize'] = json.loads(new_pending_json)
with open(state_file, 'w') as f:
    json.dump(d, f, indent=2)
PYEOF

  if (( finalized > 0 || reverted > 0 )); then
    log "Finalize pass: ${finalized} completed, ${reverted} reverted."
  fi
}

# ── Phase 2: Check if current pipeline stage should advance ──────────────────
run_advance() {
  local state; state="$(read_state)"

  local auto_advance; auto_advance="$(echo "$state" | python3 -c "
import json,sys; d=json.loads(sys.stdin.read()); print(d.get('autoAdvance', True))
" 2>/dev/null || echo "True")"

  if [[ "$auto_advance" == "False" ]]; then
    log "autoAdvance=False — skipping automatic stage advance."
    return 0
  fi

  local stage; stage="$(echo "$state" | python3 -c "
import json,sys; d=json.loads(sys.stdin.read()); print(d.get('stage',''))
" 2>/dev/null || echo "")"

  local status; status="$(echo "$state" | python3 -c "
import json,sys; d=json.loads(sys.stdin.read()); print(d.get('status',''))
" 2>/dev/null || echo "")"

  local target_version; target_version="$(echo "$state" | python3 -c "
import json,sys; d=json.loads(sys.stdin.read()); print(d.get('targetVersion',''))
" 2>/dev/null || echo "")"

  local stage_started_at; stage_started_at="$(echo "$state" | python3 -c "
import json,sys; d=json.loads(sys.stdin.read()); print(d.get('stageStartedAt',''))
" 2>/dev/null || echo "")"

  [[ -z "$stage" || -z "$target_version" ]] && return 0
  [[ "$stage" == "stable" || "$stage" == "built" ]] && return 0
  [[ "$status" == "rollback" ]] && return 0

  # Determine required soak hours for this stage
  local required_hours
  case "$stage" in
    staging)     required_hours=0 ;;      # No soak for staging → canary
    canary)      required_hours=$CANARY_SOAK_HOURS ;;
    rolling_10 | rolling_25 | rolling_50) required_hours=$ROLLING_SOAK_HOURS ;;
    *)           return 0 ;;
  esac

  # Check elapsed time
  local elapsed_secs=0
  if [[ -n "$stage_started_at" ]]; then
    elapsed_secs="$(seconds_since "$stage_started_at")"
  fi
  local elapsed_hours; elapsed_hours=$(( elapsed_secs / 3600 ))

  log "Stage: ${stage} | Elapsed: ${elapsed_hours}h / ${required_hours}h required | Target: ${target_version}"

  if (( elapsed_hours < required_hours )); then
    local remaining; remaining=$(( required_hours - elapsed_hours ))
    log "  Still soaking — ${remaining}h remaining before auto-advance."
    return 0
  fi

  # Soak complete — check fleet health of updated tenants
  local updated_tenants; updated_tenants="$(echo "$state" | python3 -c "
import json,sys
d=json.loads(sys.stdin.read())
print('\n'.join(d.get('updatedTenants',[])))
" 2>/dev/null || echo "")"

  if [[ -z "$updated_tenants" ]]; then
    log "  No updated tenants to health-check — advancing anyway."
  else
    local health_failures=0
    while IFS= read -r slug; do
      [[ -z "$slug" ]] && continue
      # Check health via Tiger Claw API
      local tenant_health
      tenant_health="$(api_get "/admin/fleet/${slug}" \
        | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('health',{}).get('httpReachable','false'))" \
        2>/dev/null || echo "false")"
      if [[ "$tenant_health" != "True" && "$tenant_health" != "true" ]]; then
        warn "  Health check FAILED for ${slug} — not advancing yet"
        ((health_failures++))
      fi
    done <<< "$updated_tenants"

    if (( health_failures > 0 )); then
      log "  ${health_failures} tenant(s) failing health — not advancing. Will retry next run."
      return 0
    fi
    log "  All updated tenants healthy."
  fi

  # Determine next stage and call deploy.sh
  local next_stage
  case "$stage" in
    staging)    next_stage="canary" ;;
    canary)     next_stage="rolling_10" ;;
    rolling_10) next_stage="rolling_25" ;;
    rolling_25) next_stage="rolling_50" ;;
    rolling_50) next_stage="rolling_100" ;;
    *) return 0 ;;
  esac

  log "✅ Soak complete. Advancing: ${stage} → ${next_stage} for ${target_version}"

  # Alert admin before auto-advance
  curl -sf -X POST \
    -H "Authorization: Bearer ${ADMIN_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"message\":\"🚀 Pipeline auto-advance: ${stage} → ${next_stage} for ${target_version} (soak complete)\"}" \
    "${TIGER_CLAW_API_URL}/admin/alerts" 2>/dev/null || true

  # Call deploy.sh for the next stage
  if [[ "$next_stage" == "canary" ]]; then
    "$DEPLOY_SCRIPT" canary "$target_version"
  else
    local pct; pct="${next_stage#rolling_}"
    "$DEPLOY_SCRIPT" rollout "$target_version" "$pct"
  fi
}

# ── Main ──────────────────────────────────────────────────────────────────────
log "=== pipeline-advance.sh starting ==="

run_finalize
run_advance

log "=== pipeline-advance.sh complete ==="
