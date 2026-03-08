---
description: Deploy Tiger Claw API to GCP Cloud Run
---

# Deploy to GCP Cloud Run

This workflow deploys the Tiger Claw API to Google Cloud Run with managed PostgreSQL and Redis.

## Prerequisites
// turbo-all

1. Install gcloud CLI: `brew install google-cloud-sdk`
2. Install terraform: `brew install terraform`
3. Authenticate: `gcloud auth login`
4. Set project: `gcloud config set project hybrid-matrix-472500-k5`

## First-Time Setup (run once)

5. Push secrets from `.env` to GCP Secret Manager:
```bash
cd /Users/brentbryson/Tigerclaw-Anti_Gravity/tiger-claw && ./ops/setup-secrets.sh
```

6. Provision infrastructure (VPC, Cloud SQL, Redis, VPC Connector):
```bash
cd /Users/brentbryson/Tigerclaw-Anti_Gravity/tiger-claw/ops/gcp-terraform && terraform init && terraform apply -var="db_password=REDACTED_DB_PASSWORD"
```

## Deploy API

7. Build and push Docker image, deploy to Cloud Run:
```bash
cd /Users/brentbryson/Tigerclaw-Anti_Gravity/tiger-claw && ./ops/deploy-cloudrun.sh
```

## Verify

8. Get the Cloud Run URL and verify:
```bash
curl -s https://$(gcloud run services describe tiger-claw-api --region=us-central1 --format='value(status.url)' | sed 's|https://||')/health | python3 -m json.tool
```

9. Update `TIGER_CLAW_API_URL` in `.env` and re-push secrets:
```bash
# Set the Cloud Run URL in .env as TIGER_CLAW_API_URL=https://tiger-claw-api-XXXX.run.app
# Then re-run: ./ops/setup-secrets.sh
```

## Subsequent Deploys

Just run step 7 again — `./ops/deploy-cloudrun.sh` handles everything.
