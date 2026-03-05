# Tiger Claw GCP / GKE Deployment Guide

Welcome to the modernized, enterprise-grade deployment strategy for the Tiger Claw engine. This architecture replaces the fragile single-node Docker setup with a scalable Google Kubernetes Engine (GKE) cluster.

## Why GKE?
1. **True Isolation and Scale**: One Pod = One Tenant. No sharing volumes on a single Droplet.
2. **Self-Healing**: If a node fails, Kubernetes reschedules the tenant's bot onto a healthy node automatically.
3. **Zero-Downtime Rollouts**: `kubectl rollout` replaces the hacky `update.sh` bash scripts. Kubernetes natively checks the `/readyz` probe before terminating the old container.

## Architecture Components
- **GKE Cluster**: Runs the tenant OpenClaw bots and the API server.
- **Google Cloud SQL**: A managed PostgreSQL database for platform-wide data (replaces local Postgres).
- **Persistent Volume Claims (PVCs)**: Each tenant pod automatically mounts a 1GB PVC to store their isolated SQLite `.db` file.
- **Bot Pool CronJob**: Automates the `create_bots.ts` MTProto script to run every 6 hours, ensuring the platform always has warm Telegram bot tokens.

## Prerequisites
1. [Google Cloud CLI (`gcloud`)](https://cloud.google.com/sdk/docs/install) installed and authenticated.
2. [Terraform](https://developer.hashicorp.com/terraform/downloads) installed.
3. `kubectl` installed.

---

## 🚀 Step 1: Provision the Infrastructure

We use Terraform to automatically spin up the network, cluster, and database.

```bash
cd ops/gcp-terraform
terraform init
terraform apply -var="project_id=YOUR_GCP_PROJECT_ID" -var="db_password=YOUR_SUPER_SECRET_PASSWORD"
```

Once applied, configure your local `kubectl` to talk to the new cluster:
```bash
gcloud container clusters get-credentials tiger-claw-cluster --region us-central1 --project YOUR_GCP_PROJECT_ID
```

## 🤖 Step 2: Automate the Bot Pool

The bot pool generation script is now containerized and runs on a Kubernetes schedule (CronJob). You need to store your Telegram API credentials in a Kubernetes Secret first.

```bash
kubectl create secret generic tiger-claw-secrets \
  --from-literal=telegram-api-id=YOUR_API_ID \
  --from-literal=telegram-api-hash=YOUR_API_HASH \
  --from-literal=admin-token=YOUR_API_ADMIN_TOKEN

# Apply the CronJob
kubectl apply -f botpool-cronjob.yaml
```

The cluster will now spawn a job every 6 hours to create 5 new Telegram bots automatically.

## 🕸 Step 3: Deployment Updates

You no longer need to use `ops/update.sh` to update tenant images. 

To update a specific tenant (e.g. `acme-tenant`) to a new Docker image tag:
```bash
kubectl set image deployment/tiger-claw-acme-tenant bot=ghcr.io/bbrysonelite-max/tiger-claw:v2.0
```

Kubernetes will start the new container, wait for the `/readyz` endpoint to return 200 via the `readinessProbe`, and only then terminate the old container. If it fails, the update halts, achieving what `update.sh` attempted natively.
