terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ------------------------------------------------------------------------------
# Enable Required APIs
# ------------------------------------------------------------------------------
resource "google_project_service" "required_apis" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "redis.googleapis.com",
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "vpcaccess.googleapis.com",
    "cloudbuild.googleapis.com",
    "containerregistry.googleapis.com",
  ])
  service            = each.key
  disable_on_destroy = false
}

# ------------------------------------------------------------------------------
# Network / VPC (Required for private Cloud SQL + Redis)
# ------------------------------------------------------------------------------
resource "google_compute_network" "vpc" {
  name                    = "tiger-claw-vpc"
  auto_create_subnetworks = "false"
  depends_on              = [google_project_service.required_apis]
}

resource "google_compute_subnetwork" "subnet" {
  name                     = "tiger-claw-subnet"
  region                   = var.region
  network                  = google_compute_network.vpc.name
  ip_cidr_range            = "10.10.0.0/24"
  private_ip_google_access = true
}

resource "google_compute_global_address" "private_ip_address" {
  name          = "tiger-claw-private-ip"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "private_vpc_connection" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip_address.name]
}

# ------------------------------------------------------------------------------
# VPC Connector (Cloud Run → private VPC for SQL/Redis)
# ------------------------------------------------------------------------------
resource "google_vpc_access_connector" "connector" {
  name          = "tiger-claw-connector"
  region        = var.region
  network       = google_compute_network.vpc.name
  ip_cidr_range = "10.8.0.0/28"

  depends_on = [google_project_service.required_apis]
}

# ------------------------------------------------------------------------------
# Cloud SQL (PostgreSQL HA)
# ------------------------------------------------------------------------------
resource "google_sql_database_instance" "master" {
  name                = "tiger-claw-postgres-ha"
  database_version    = "POSTGRES_15"
  region              = var.region
  deletion_protection = true

  settings {
    tier              = "db-custom-2-8192" # 2 vCPU, 8GB RAM
    availability_type = "REGIONAL"         # Cross-zone HA failover

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
    }

    ip_configuration {
      ipv4_enabled    = false # Force private network
      private_network = google_compute_network.vpc.id
    }
  }

  depends_on = [google_service_networking_connection.private_vpc_connection]
}

resource "google_sql_database" "database" {
  name     = "tiger_claw_shared"
  instance = google_sql_database_instance.master.name
}

resource "google_sql_user" "botcraft" {
  name     = "botcraft"
  instance = google_sql_database_instance.master.name
  password = var.db_password
}

# ------------------------------------------------------------------------------
# Cloud Memorystore (Redis HA) — BullMQ queues + chat history
# ------------------------------------------------------------------------------
resource "google_redis_instance" "tiger_cache" {
  name               = "tiger-claw-redis-ha"
  tier               = "STANDARD_HA" # Cross-zone replication
  memory_size_gb     = 5
  region             = var.region
  redis_version      = "REDIS_6_X"
  display_name       = "Tiger Claw Queues"
  authorized_network = google_compute_network.vpc.id

  depends_on = [google_service_networking_connection.private_vpc_connection]
}

# ------------------------------------------------------------------------------
# Cloud Run Service (replaces GKE — stateless multi-tenant)
# Min 1 instance to prevent cold starts, auto-scales to 10.
# All secrets injected from Secret Manager.
# ------------------------------------------------------------------------------
resource "google_cloud_run_v2_service" "api" {
  name     = "tiger-claw-api"
  location = var.region

  template {
    scaling {
      min_instance_count = 1
      max_instance_count = 10
    }

    vpc_access {
      connector = google_vpc_access_connector.connector.id
      egress    = "ALL_TRAFFIC"
    }

    containers {
      image = "gcr.io/${var.project_id}/tiger-claw-api:latest"

      ports {
        container_port = 4000
      }

      resources {
        limits = {
          cpu    = "2"
          memory = "2Gi"
        }
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "FRONTEND_URL"
        value = "https://tigerclaw.io"
      }
      env {
        name  = "TIGER_CLAW_API_URL"
        value = "https://tiger-claw-api-${var.project_hash}.${var.region}.run.app"
      }

      # Secrets from Secret Manager
      dynamic "env" {
        for_each = {
          DATABASE_URL              = "tiger-claw-database-url"
          REDIS_URL                 = "tiger-claw-redis-url"
          GOOGLE_API_KEY            = "tiger-claw-google-api-key"
          STRIPE_SECRET_KEY         = "tiger-claw-stripe-secret-key"
          STRIPE_WEBHOOK_SECRET     = "tiger-claw-stripe-webhook-secret"
          ADMIN_TOKEN               = "tiger-claw-admin-token"
          ADMIN_TELEGRAM_BOT_TOKEN  = "tiger-claw-admin-telegram-bot-token"
          TIGER_CLAW_HIVE_TOKEN     = "tiger-claw-hive-token"
          PLATFORM_ONBOARDING_KEY   = "tiger-claw-platform-onboarding-key"
          PLATFORM_EMERGENCY_KEY    = "tiger-claw-platform-emergency-key"
          ENCRYPTION_KEY            = "tiger-claw-encryption-key"
          STRIPE_PRICE_BYOK         = "tiger-claw-stripe-price-byok"
          SERPER_KEY_1              = "tiger-claw-serper-key-1"
          SERPER_KEY_2              = "tiger-claw-serper-key-2"
          SERPER_KEY_3              = "tiger-claw-serper-key-3"
        }
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
    }

    timeout = "300s"
  }

  depends_on = [google_project_service.required_apis]
}

# Allow public access (Telegram webhooks, Stripe webhooks, wizard)
resource "google_cloud_run_v2_service_iam_member" "public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ------------------------------------------------------------------------------
# Outputs
# ------------------------------------------------------------------------------
output "api_url" {
  value       = google_cloud_run_v2_service.api.uri
  description = "Cloud Run API URL"
}

output "sql_connection_name" {
  value       = google_sql_database_instance.master.connection_name
  description = "Cloud SQL connection name for proxy"
}

output "redis_host" {
  value       = google_redis_instance.tiger_cache.host
  description = "Redis HA host"
}
