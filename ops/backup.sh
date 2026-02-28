#!/bin/bash
# Tiger Claw Automated Backup Script
# TIGERCLAW-MASTER-SPEC-v2.md Block 6.3
#
# Backup schedule (managed by cron on the server):
#   Platform PostgreSQL    — every 6 hours  → offsite (S3/Backblaze)
#   All tenant SQLite DBs  — daily          → offsite
#   Container configs      — on change      → offsite (30 versions kept)
#   Hive patterns          — daily          → offsite (90 days retention)
#
# Cron entries to add to server (crontab -e):
#   0 */6 * * *   /home/ubuntu/tiger-claw/ops/backup.sh postgres
#   0 2 * * *     /home/ubuntu/tiger-claw/ops/backup.sh sqlite
#   0 2 * * *     /home/ubuntu/tiger-claw/ops/backup.sh hive
#   0 3 * * *     /home/ubuntu/tiger-claw/ops/backup.sh configs
#
# Required env vars (set in /etc/environment or sourced .env.deploy):
#   BACKUP_DEST       — s3://bucket/path OR b2://bucket/path
#   DATABASE_URL      — PostgreSQL connection string
#   CUSTOMERS_DIR     — /home/ubuntu/customers (parent of per-tenant dirs)
#   TIGER_CLAW_API_URL — for Hive pattern backup
#
# Uses: aws-cli (s3://) or rclone (b2://)
set -euo pipefail

# ── Config ─────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/../.env.deploy" ]; then
  source "$SCRIPT_DIR/../.env.deploy"
fi

BACKUP_DEST="${BACKUP_DEST:-s3://tiger-claw-backups}"
DATABASE_URL="${DATABASE_URL:-postgresql://botcraft:chatwoot123@localhost:5432/tiger_bot}"
CUSTOMERS_DIR="${CUSTOMERS_DIR:-/home/ubuntu/customers}"
BACKUP_LOCAL_TMP="${BACKUP_LOCAL_TMP:-/tmp/tiger-claw-backups}"
POSTGRES_RETENTION_DAYS=30
SQLITE_RETENTION_DAYS=30
HIVE_RETENTION_DAYS=90
CONFIG_VERSIONS=30

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
DATE="$(date +%Y%m%d)"

mkdir -p "$BACKUP_LOCAL_TMP"

log() { echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') $*"; }
error() { echo "[backup] ERROR: $*" >&2; exit 1; }

# ── Upload helper (supports s3:// via aws-cli and b2:// via rclone) ─────────
upload() {
  local src="$1"
  local dest_key="$2"
  local full_dest="${BACKUP_DEST}/${dest_key}"

  if [[ "$BACKUP_DEST" == s3://* ]]; then
    aws s3 cp "$src" "$full_dest" --quiet
  elif [[ "$BACKUP_DEST" == b2://* ]]; then
    rclone copy "$src" "${full_dest%/*}" --quiet
  else
    # Fallback: local copy (for testing)
    local local_dir="${BACKUP_DEST}/${dest_key%/*}"
    mkdir -p "$local_dir"
    cp "$src" "${BACKUP_DEST}/${dest_key}"
  fi
  log "Uploaded → ${dest_key}"
}

# ── PostgreSQL backup ────────────────────────────────────────────────────────
backup_postgres() {
  log "Starting PostgreSQL backup..."
  local out="${BACKUP_LOCAL_TMP}/postgres_${TIMESTAMP}.sql.gz"

  pg_dump "$DATABASE_URL" | gzip > "$out"
  upload "$out" "postgres/${DATE}/tiger_bot_${TIMESTAMP}.sql.gz"
  rm -f "$out"

  # Prune old backups (remote — only for S3)
  if [[ "$BACKUP_DEST" == s3://* ]]; then
    local cutoff
    cutoff="$(date -d "-${POSTGRES_RETENTION_DAYS} days" '+%Y%m%d' 2>/dev/null || \
              date -v-${POSTGRES_RETENTION_DAYS}d '+%Y%m%d')"
    log "Pruning PostgreSQL backups older than ${POSTGRES_RETENTION_DAYS} days (before ${cutoff})"
    aws s3 ls "${BACKUP_DEST}/postgres/" | awk '{print $2}' | while read -r prefix; do
      folder="${prefix%/}"
      if [[ "$folder" < "$cutoff" ]]; then
        aws s3 rm "${BACKUP_DEST}/postgres/${folder}/" --recursive --quiet
        log "Pruned: ${folder}"
      fi
    done
  fi

  log "PostgreSQL backup complete."
}

# ── SQLite backup (all per-tenant databases) ─────────────────────────────────
backup_sqlite() {
  log "Starting SQLite backup for all tenants..."
  local count=0

  if [ ! -d "$CUSTOMERS_DIR" ]; then
    log "WARN: CUSTOMERS_DIR ($CUSTOMERS_DIR) not found — skipping SQLite backup"
    return 0
  fi

  for tenant_dir in "$CUSTOMERS_DIR"/*/; do
    local slug
    slug="$(basename "$tenant_dir")"
    local data_dir="${tenant_dir}data"

    # Find SQLite files (OpenClaw typically uses *.db or *.sqlite)
    while IFS= read -r -d '' dbfile; do
      local dbname
      dbname="$(basename "$dbfile")"
      local out="${BACKUP_LOCAL_TMP}/${slug}_${dbname}_${TIMESTAMP}.gz"

      # Safe online backup via sqlite3 .backup (handles WAL correctly)
      if command -v sqlite3 &>/dev/null; then
        sqlite3 "$dbfile" ".backup '${BACKUP_LOCAL_TMP}/${slug}_${dbname}_raw.db'" 2>/dev/null || cp "$dbfile" "${BACKUP_LOCAL_TMP}/${slug}_${dbname}_raw.db"
        gzip -c "${BACKUP_LOCAL_TMP}/${slug}_${dbname}_raw.db" > "$out"
        rm -f "${BACKUP_LOCAL_TMP}/${slug}_${dbname}_raw.db"
      else
        gzip -c "$dbfile" > "$out"
      fi

      upload "$out" "sqlite/${DATE}/${slug}/${dbname}_${TIMESTAMP}.gz"
      rm -f "$out"
      ((count++))
    done < <(find "$data_dir" -name "*.db" -o -name "*.sqlite" -print0 2>/dev/null)
  done

  log "SQLite backup complete: ${count} databases backed up."
}

# ── Container config backup (openclaw.json per tenant, on-change) ────────────
backup_configs() {
  log "Starting config backup..."
  local count=0

  if [ ! -d "$CUSTOMERS_DIR" ]; then
    log "WARN: CUSTOMERS_DIR not found — skipping config backup"
    return 0
  fi

  for tenant_dir in "$CUSTOMERS_DIR"/*/; do
    local slug
    slug="$(basename "$tenant_dir")"
    local compose="${tenant_dir}docker-compose.yml"

    if [ -f "$compose" ]; then
      local out="${BACKUP_LOCAL_TMP}/${slug}_compose_${TIMESTAMP}.yml"
      cp "$compose" "$out"
      upload "$out" "configs/${slug}/docker-compose_${TIMESTAMP}.yml"
      rm -f "$out"
      ((count++))

      # Prune to keep only CONFIG_VERSIONS most recent
      if [[ "$BACKUP_DEST" == s3://* ]]; then
        local versions
        versions="$(aws s3 ls "${BACKUP_DEST}/configs/${slug}/" | awk '{print $4}' | sort)"
        local total
        total="$(echo "$versions" | wc -l)"
        if (( total > CONFIG_VERSIONS )); then
          local to_delete
          to_delete="$(echo "$versions" | head -n $((total - CONFIG_VERSIONS)))"
          while IFS= read -r f; do
            aws s3 rm "${BACKUP_DEST}/configs/${slug}/${f}" --quiet
          done <<< "$to_delete"
        fi
      fi
    fi
  done

  log "Config backup complete: ${count} configs backed up."
}

# ── Hive pattern backup ───────────────────────────────────────────────────────
backup_hive() {
  log "Starting Hive pattern backup..."

  # Dump hive_patterns table from PostgreSQL
  local out="${BACKUP_LOCAL_TMP}/hive_patterns_${TIMESTAMP}.sql.gz"
  pg_dump "$DATABASE_URL" --table=hive_patterns | gzip > "$out"
  upload "$out" "hive/${DATE}/hive_patterns_${TIMESTAMP}.sql.gz"
  rm -f "$out"

  # Prune old Hive backups
  if [[ "$BACKUP_DEST" == s3://* ]]; then
    local cutoff
    cutoff="$(date -d "-${HIVE_RETENTION_DAYS} days" '+%Y%m%d' 2>/dev/null || \
              date -v-${HIVE_RETENTION_DAYS}d '+%Y%m%d')"
    aws s3 ls "${BACKUP_DEST}/hive/" | awk '{print $2}' | while read -r prefix; do
      folder="${prefix%/}"
      if [[ "$folder" < "$cutoff" ]]; then
        aws s3 rm "${BACKUP_DEST}/hive/${folder}/" --recursive --quiet
        log "Pruned hive backup: ${folder}"
      fi
    done
  fi

  log "Hive backup complete."
}

# ── Main dispatch ─────────────────────────────────────────────────────────────
case "${1:-}" in
  postgres)  backup_postgres ;;
  sqlite)    backup_sqlite ;;
  configs)   backup_configs ;;
  hive)      backup_hive ;;
  all)
    backup_postgres
    backup_sqlite
    backup_configs
    backup_hive
    ;;
  *)
    echo "Usage: $0 postgres|sqlite|configs|hive|all" >&2
    echo ""
    echo "Cron setup (add to crontab -e on server):"
    echo "  0 */6 * * *   $(realpath "$0") postgres"
    echo "  0 2   * * *   $(realpath "$0") sqlite"
    echo "  0 2   * * *   $(realpath "$0") hive"
    echo "  0 3   * * *   $(realpath "$0") configs"
    exit 1
    ;;
esac
