#!/bin/bash
# Tiger Claw — Deploy to Cloud Run
# Run this from the IDX terminal (gcloud must be authenticated)
#
# Usage: ./ops/deploy-cloudrun.sh

set -euo pipefail

PROJECT_ID="hybrid-matrix-472500-k5"
REGION="us-central1"
SERVICE_NAME="tiger-claw-api"
IMAGE="gcr.io/${PROJECT_ID}/${SERVICE_NAME}:latest"

echo "==> Building and pushing Docker image..."
gcloud builds submit ./api \
  --tag "$IMAGE" \
  --project "$PROJECT_ID"

echo "==> Deploying to Cloud Run..."
gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --platform managed \
  --allow-unauthenticated \
  --port 4000 \
  --memory 2Gi \
  --cpu 2 \
  --min-instances 1 \
  --max-instances 10 \
  --timeout 300 \
  --set-env-vars "NODE_ENV=production,PORT=4000" \
  --update-secrets \
    "DATABASE_URL=tiger-claw-database-url:latest,\
REDIS_URL=tiger-claw-redis-url:latest,\
GOOGLE_API_KEY=tiger-claw-google-api-key:latest,\
STRIPE_SECRET_KEY=tiger-claw-stripe-secret-key:latest,\
STRIPE_WEBHOOK_SECRET=tiger-claw-stripe-webhook-secret:latest,\
ADMIN_TOKEN=tiger-claw-admin-token:latest,\
ADMIN_TELEGRAM_BOT_TOKEN=tiger-claw-admin-telegram-bot-token:latest,\
TIGER_CLAW_HIVE_TOKEN=tiger-claw-hive-token:latest,\
PLATFORM_ONBOARDING_KEY=tiger-claw-platform-onboarding-key:latest,\
PLATFORM_EMERGENCY_KEY=tiger-claw-platform-emergency-key:latest,\
ENCRYPTION_KEY=tiger-claw-encryption-key:latest,\
SERPER_KEY_1=tiger-claw-serper-key-1:latest,\
SERPER_KEY_2=tiger-claw-serper-key-2:latest,\
SERPER_KEY_3=tiger-claw-serper-key-3:latest"

echo ""
echo "==> Deployment complete!"
gcloud run services describe "$SERVICE_NAME" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --format "value(status.url)"
