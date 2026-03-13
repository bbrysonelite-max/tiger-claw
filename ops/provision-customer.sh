#!/bin/bash
# Provision a new customer bot on the production server.
# Adapted from v4 per TIGERCLAW-MASTER-SPEC-v2.md Block 5.3:
#   - Per-tenant SQLite inside container (not shared PostgreSQL for tenant data)
#   - Four-layer key injection instead of single ANTHROPIC_API_KEY
#   - Regional config and flavor config added to container environment
#
# Usage:
#   ./ops/provision-customer.sh \
#     --slug     john-doe \
#     --name     "John Doe" \
#     --token    "8431854880:AAE..." \
#     --port     18803 \
#     --lang     en \
#     --flavor   network-marketer|real-estate|health-wellness \
#     --region   us-en|th-th
#
# Optional:
#   --tenant-id     "uuid"            (auto-generated if omitted)
#   --timezone      "America/Phoenix" (default: UTC)
#   --onboard-key   "sk-ant-..."      (Layer 1 onboarding key; falls back to env)
#
# Reads from .env.deploy in repo root if present.
#
set -euo pipefail

# ── Load .env.deploy if present ───────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/../.env.deploy" ]; then
  source "$SCRIPT_DIR/../.env.deploy"
fi

# ── Defaults ──────────────────────────────────────────────────────────────────
SERVER_IP="${SERVER_IP:?ERROR: SERVER_IP must be set}"
SSH_KEY_PATH="${SSH_KEY_PATH:?ERROR: SSH_KEY_PATH must be set (path to .pem key file)}"

# Four-layer key system
PLATFORM_ONBOARDING_KEY="${PLATFORM_ONBOARDING_KEY:?ERROR: PLATFORM_ONBOARDING_KEY must be set}"
PLATFORM_EMERGENCY_KEY="${PLATFORM_EMERGENCY_KEY:?ERROR: PLATFORM_EMERGENCY_KEY must be set}"

ENCRYPTION_KEY="${ENCRYPTION_KEY:?ERROR: ENCRYPTION_KEY must be set}"
SERPER_KEY_1="${SERPER_KEY_1:?ERROR: SERPER_KEY_1 must be set}"
SERPER_KEY_2="${SERPER_KEY_2:?ERROR: SERPER_KEY_2 must be set}"
SERPER_KEY_3="${SERPER_KEY_3:?ERROR: SERPER_KEY_3 must be set}"
TIGER_CLAW_API_URL="${TIGER_CLAW_API_URL:?ERROR: TIGER_CLAW_API_URL must be set}"
TIGER_CLAW_HIVE_TOKEN="${TIGER_CLAW_HIVE_TOKEN:-}"
DATABASE_URL="${DATABASE_URL:?ERROR: DATABASE_URL must be set}"
REDIS_URL="${REDIS_URL:?ERROR: REDIS_URL must be set}"

# ── Parse arguments ───────────────────────────────────────────────────────────
SLUG="" NAME="" TOKEN="" PORT="" LANG="en" TENANT_ID="" FLAVOR="network-marketer"
REGION="us-en" TIMEZONE="UTC" ONBOARD_KEY=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --slug)        SLUG="$2";        shift 2 ;;
    --name)        NAME="$2";        shift 2 ;;
    --token)       TOKEN="$2";       shift 2 ;;
    --port)        PORT="$2";        shift 2 ;;
    --lang)        LANG="$2";        shift 2 ;;
    --tenant-id)   TENANT_ID="$2";   shift 2 ;;
    --flavor)      FLAVOR="$2";      shift 2 ;;
    --region)      REGION="$2";      shift 2 ;;
    --timezone)    TIMEZONE="$2";    shift 2 ;;
    --onboard-key) ONBOARD_KEY="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [ -n "$ONBOARD_KEY" ]; then
  PLATFORM_ONBOARDING_KEY="$ONBOARD_KEY"
fi

# ── Validate ──────────────────────────────────────────────────────────────────
error() { echo "ERROR: $*" >&2; exit 1; }
[ -z "$SLUG" ]   && error "--slug is required (e.g. john-doe)"
[ -z "$NAME" ]   && error "--name is required (e.g. 'John Doe')"
[ -z "$TOKEN" ]  && error "--token is required (Telegram bot token from @BotFather)"
[ -z "$PORT" ]   && error "--port is required (e.g. 18803)"
[ -z "$PLATFORM_ONBOARDING_KEY" ] && error "PLATFORM_ONBOARDING_KEY is required (Layer 1 key)"

if [ -z "$TENANT_ID" ]; then
  TENANT_ID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
fi

echo "=== Provisioning: $NAME ($SLUG) ==="
echo "  Port:      $PORT"
echo "  Bot token: ${TOKEN:0:20}..."
echo "  Tenant ID: $TENANT_ID"
echo "  Language:  $LANG"
echo "  Flavor:    $FLAVOR"
echo "  Region:    $REGION"
echo "  Timezone:  $TIMEZONE"
echo ""
read -rp "Proceed? (yes/no): " CONFIRM
[ "$CONFIRM" != "yes" ] && echo "Aborted." && exit 0

# ── Clear Telegram webhook ────────────────────────────────────────────────────
echo "Clearing Telegram webhook..."
curl -s "https://api.telegram.org/bot${TOKEN}/deleteWebhook?drop_pending_updates=true" | \
  python3 -c "import sys,json; r=json.load(sys.stdin); print('  OK' if r.get('ok') else f'  WARN: {r}')"

# ── Create compose file and start container on server ────────────────────────
echo "Creating container on server..."

COMPOSE_CONTENT="version: '3.9'
services:
  tiger-claw-${SLUG}:
    image: tiger-claw-scout:latest
    container_name: tiger-claw-${SLUG}
    restart: unless-stopped
    ports:
      - '${PORT}:18789'
    environment:
      TENANT_ID: '${TENANT_ID}'
      TENANT_NAME: '${NAME}'
      PREFERRED_LANGUAGE: '${LANG}'
      TELEGRAM_BOT_TOKEN: '${TOKEN}'
      TZ: '${TIMEZONE}'
      BOT_FLAVOR: '${FLAVOR}'
      REGION: '${REGION}'
      PLATFORM_ONBOARDING_KEY: '${PLATFORM_ONBOARDING_KEY}'
      PLATFORM_EMERGENCY_KEY: '${PLATFORM_EMERGENCY_KEY}'
      TIGER_CLAW_API_URL: '${TIGER_CLAW_API_URL}'
      TIGER_CLAW_TENANT_ID: '${TENANT_ID}'
      TIGER_CLAW_HIVE_TOKEN: '${TIGER_CLAW_HIVE_TOKEN}'
      DATABASE_URL: '${DATABASE_URL}'
      REDIS_URL: '${REDIS_URL}'
      SERPER_KEY_1: '${SERPER_KEY_1}'
      SERPER_KEY_2: '${SERPER_KEY_2}'
      SERPER_KEY_3: '${SERPER_KEY_3}'
      ENCRYPTION_KEY: '${ENCRYPTION_KEY}'
    volumes:
      - /home/ubuntu/customers/${SLUG}/data:/app/data
    extra_hosts:
      - 'host.docker.internal:host-gateway'"

ssh -i "${SSH_KEY_PATH}" -o StrictHostKeyChecking=no root@"${SERVER_IP}" \
  "mkdir -p /home/ubuntu/customers/${SLUG}/data && cat > /home/ubuntu/customers/${SLUG}/docker-compose.yml" \
  <<< "$COMPOSE_CONTENT"

ssh -i "${SSH_KEY_PATH}" -o StrictHostKeyChecking=no root@"${SERVER_IP}" << ENDSSH
set -euo pipefail
cd /home/ubuntu/customers/${SLUG}
docker compose up -d
echo "Waiting 10s for container to start..."
sleep 10
docker compose ps
ENDSSH

echo ""
echo "=== Done: $NAME provisioned ==="
echo "  Container: tiger-claw-${SLUG}"
echo "  Port:      ${PORT}"
echo "  Tenant ID: ${TENANT_ID}"
echo "  Flavor:    ${FLAVOR} / Region: ${REGION}"
echo ""
echo "Next: message the bot on Telegram to begin the onboarding interview."
