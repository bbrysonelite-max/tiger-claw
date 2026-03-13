#!/bin/bash
# Tiger Claw — Create GCP Secret Manager secrets from .env
# Run ONCE from IDX terminal before first Cloud Run deploy
#
# Usage: ./ops/setup-secrets.sh

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:?ERROR: GCP_PROJECT_ID must be set}"
ENV_FILE="./api/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Copy api/.env.example and fill in values."
  exit 1
fi

create_or_update_secret() {
  local name="$1"
  local value="$2"

  if gcloud secrets describe "$name" --project "$PROJECT_ID" &>/dev/null; then
    echo "  Updating $name"
    echo -n "$value" | gcloud secrets versions add "$name" \
      --data-file=- --project "$PROJECT_ID"
  else
    echo "  Creating $name"
    echo -n "$value" | gcloud secrets create "$name" \
      --data-file=- --project "$PROJECT_ID" \
      --replication-policy="automatic"
  fi
}

echo "==> Loading secrets from $ENV_FILE into GCP Secret Manager..."

# Read .env and create secrets
while IFS= read -r line || [[ -n "$line" ]]; do
  # Skip comments and empty lines
  [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue

  key="${line%%=*}"
  value="${line#*=}"

  case "$key" in
    DATABASE_URL)      create_or_update_secret "tiger-claw-database-url" "$value" ;;
    REDIS_URL)         create_or_update_secret "tiger-claw-redis-url" "$value" ;;
    GOOGLE_API_KEY)    create_or_update_secret "tiger-claw-google-api-key" "$value" ;;
    STRIPE_SECRET_KEY) create_or_update_secret "tiger-claw-stripe-secret-key" "$value" ;;
    STRIPE_WEBHOOK_SECRET) create_or_update_secret "tiger-claw-stripe-webhook-secret" "$value" ;;
    ADMIN_TOKEN)       create_or_update_secret "tiger-claw-admin-token" "$value" ;;
    ADMIN_TELEGRAM_BOT_TOKEN) create_or_update_secret "tiger-claw-admin-telegram-bot-token" "$value" ;;
    TIGER_CLAW_HIVE_TOKEN) create_or_update_secret "tiger-claw-hive-token" "$value" ;;
    PLATFORM_ONBOARDING_KEY) create_or_update_secret "tiger-claw-platform-onboarding-key" "$value" ;;
    PLATFORM_EMERGENCY_KEY) create_or_update_secret "tiger-claw-platform-emergency-key" "$value" ;;
    ENCRYPTION_KEY)    create_or_update_secret "tiger-claw-encryption-key" "$value" ;;
    SERPER_KEY_1)      create_or_update_secret "tiger-claw-serper-key-1" "$value" ;;
    SERPER_KEY_2)      create_or_update_secret "tiger-claw-serper-key-2" "$value" ;;
    SERPER_KEY_3)      create_or_update_secret "tiger-claw-serper-key-3" "$value" ;;
  esac
done < "$ENV_FILE"

echo ""
echo "==> Granting Cloud Run SA access to secrets..."
SA_EMAIL="$(gcloud iam service-accounts list --project "$PROJECT_ID" \
  --filter="displayName:Default compute" --format="value(email)" | head -1)"
if [[ -n "$SA_EMAIL" ]]; then
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/secretmanager.secretAccessor" --quiet
  echo "  Granted secretmanager.secretAccessor to $SA_EMAIL"
fi

echo ""
echo "==> Done. Run ./ops/deploy-cloudrun.sh to deploy."
