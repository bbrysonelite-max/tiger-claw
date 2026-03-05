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
# Network / VPC (Requires Service Networking for Redis/SQL)
# ------------------------------------------------------------------------------
resource "google_compute_network" "vpc" {
  name                    = "tiger-claw-vpc"
  auto_create_subnetworks = "false"
}

resource "google_compute_subnetwork" "subnet" {
  name          = "tiger-claw-subnet"
  region        = var.region
  network       = google_compute_network.vpc.name
  ip_cidr_range = "10.10.0.0/24"
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
# GKE Cluster (Regional 99.9% HA)
# ------------------------------------------------------------------------------
resource "google_container_cluster" "tiger_claw" {
  name     = "tiger-claw-cluster"
  location = var.region # Regional cluster for 3x master availability

  remove_default_node_pool = true
  initial_node_count       = 1

  network    = google_compute_network.vpc.name
  subnetwork = google_compute_subnetwork.subnet.name

  deletion_protection = true

  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }
}

# ------------------------------------------------------------------------------
# GKE Node Pool
# ------------------------------------------------------------------------------
resource "google_container_node_pool" "primary_nodes" {
  name       = "tiger-claw-node-pool"
  location   = var.region
  cluster    = google_container_cluster.tiger_claw.name
  initial_node_count = 1 # 1 per zone = 3 total initial nodes

  autoscaling {
    min_node_count = 1
    max_node_count = 10
  }

  node_config {
    oauth_scopes = [
      "https://www.googleapis.com/auth/logging.write",
      "https://www.googleapis.com/auth/monitoring",
      "https://www.googleapis.com/auth/devstorage.read_only",
    ]

    machine_type = "e2-standard-4"
    tags         = ["gke-node", "tiger-claw-cluster"]
    metadata = {
      disable-legacy-endpoints = "true"
    }

    workload_metadata_config {
      mode = "GKE_METADATA"
    }
  }
}

# ------------------------------------------------------------------------------
# Cloud SQL (PostgreSQL HA)
# ------------------------------------------------------------------------------
resource "google_sql_database_instance" "master" {
  name             = "tiger-claw-postgres-ha"
  database_version = "POSTGRES_15"
  region           = var.region
  deletion_protection = true 

  settings {
    tier = "db-custom-2-8192" # 2 vCPU, 8GB RAM minimum for Enterprise
    availability_type = "REGIONAL" # Cross-zone HA failover
    
    backup_configuration {
      enabled = true
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
# Cloud Memorystore (Redis HA)
# ------------------------------------------------------------------------------
resource "google_redis_instance" "tiger_cache" {
  name           = "tiger-claw-redis-ha"
  tier           = "STANDARD_HA" # Cross-zone replication
  memory_size_gb = 5
  region         = var.region

  redis_version     = "REDIS_6_X"
  display_name      = "Tiger Claw Queues"
  authorized_network = google_compute_network.vpc.id

  depends_on = [google_service_networking_connection.private_vpc_connection]
}
