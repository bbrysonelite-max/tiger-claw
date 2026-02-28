#!/bin/bash
# Provision a new customer bot on the production server.
#
# Usage:
#   ./ops/provision-customer.sh \
#     --slug     john-doe \
#     --name     "John Doe" \
#     --token    "8431854880:AAE..." \
#     --port     18803 \
#     --lang     en \
#     --flavor   tiger|alien|airbnb
#
# Optional:
#   --tenant-id  "uuid"   (auto-generated if omitted)
#   --flavor     tiger|alien|airbnb  (default: tiger)
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
SERVER_IP="${SERVER_IP:-209.97.168.251}"
SSH_KEY_PATH="${SSH_KEY_PATH:-/Users/brentbryson/Desktop/botcraft key pair.pem}"
ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
ENCRYPTION_KEY="${ENCRYPTION_KEY:-REDACTED_ENCRYPTION_KEY}"
SERPER_KEY_1="${SERPER_KEY_1:-REDACTED_SERPER_KEY_1}"
SERPER_KEY_2="${SERPER_KEY_2:-REDACTED_SERPER_KEY_2}"
SERPER_KEY_3="${SERPER_KEY_3:-REDACTED_SERPER_KEY_3}"
TIGER_CLAW_API_URL="${TIGER_CLAW_API_URL:-http://host.docker.internal:4000}"
DATABASE_URL="postgresql://botcraft:REDACTED_DB_PASSWORD@host.docker.internal:5432/tiger_bot"
REDIS_URL="redis://host.docker.internal:6379"

# ── Parse arguments ───────────────────────────────────────────────────────────
SLUG="" NAME="" TOKEN="" PORT="" LANG="en" TENANT_ID="" FLAVOR="tiger"

while [[ $# -gt 0 ]]; do
  case $1 in
    --slug)      SLUG="$2";      shift 2 ;;
    --name)      NAME="$2";      shift 2 ;;
    --token)     TOKEN="$2";     shift 2 ;;
    --port)      PORT="$2";      shift 2 ;;
    --lang)      LANG="$2";      shift 2 ;;
    --tenant-id) TENANT_ID="$2"; shift 2 ;;
    --flavor)    FLAVOR="$2";    shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

# ── Validate ──────────────────────────────────────────────────────────────────
error() { echo "ERROR: $*" >&2; exit 1; }
[ -z "$SLUG" ]   && error "--slug is required (e.g. john-doe)"
[ -z "$NAME" ]   && error "--name is required (e.g. 'John Doe')"
[ -z "$TOKEN" ]  && error "--token is required (Telegram bot token from @BotFather)"
[ -z "$PORT" ]   && error "--port is required (e.g. 18803)"
[ -z "$ANTHROPIC_API_KEY" ] && error "ANTHROPIC_API_KEY env var is required"

if [ -z "$TENANT_ID" ]; then
  TENANT_ID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
fi

echo "=== Provisioning: $NAME ($SLUG) ==="
echo "  Port:      $PORT"
echo "  Bot token: ${TOKEN:0:20}..."
echo "  Tenant ID: $TENANT_ID"
echo "  Language:  $LANG"
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
      DATABASE_URL: '${DATABASE_URL}'
      REDIS_URL: '${REDIS_URL}'
      ANTHROPIC_API_KEY: '${ANTHROPIC_API_KEY}'
      SERPER_KEY_1: '${SERPER_KEY_1}'
      SERPER_KEY_2: '${SERPER_KEY_2}'
      SERPER_KEY_3: '${SERPER_KEY_3}'
      TIGER_CLAW_API_URL: '${TIGER_CLAW_API_URL}'
      ENCRYPTION_KEY: '${ENCRYPTION_KEY}'
      BOT_FLAVOR: '${FLAVOR}'
    extra_hosts:
      - 'host.docker.internal:host-gateway'"

ssh -i "${SSH_KEY_PATH}" -o StrictHostKeyChecking=no root@"${SERVER_IP}" \
  "mkdir -p /home/ubuntu/customers/${SLUG} && cat > /home/ubuntu/customers/${SLUG}/docker-compose.yml" \
  <<< "$COMPOSE_CONTENT"

ssh -i "${SSH_KEY_PATH}" -o StrictHostKeyChecking=no root@"${SERVER_IP}" << ENDSSH
set -euo pipefail
cd /home/ubuntu/customers/${SLUG}
docker compose up -d
echo "Waiting 10s..."
sleep 10
docker compose ps
ENDSSH

echo ""
echo "=== Done: $NAME provisioned ==="
echo "  Container: tiger-claw-${SLUG}"
echo "  Port:      ${PORT}"
echo "  Tenant ID: ${TENANT_ID}"
echo ""
echo "Next: message the bot on Telegram to verify."
