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
# GKE Cluster
# ------------------------------------------------------------------------------
resource "google_container_cluster" "tiger_claw" {
  name     = "tiger-claw-cluster"
  location = var.zone

  # We can't create a cluster with no node pool defined, but we want to only use
  # separately managed node pools. So we create the smallest possible default
  # node pool and immediately delete it.
  remove_default_node_pool = true
  initial_node_count       = 1

  # Network
  network    = google_compute_network.vpc.name
  subnetwork = google_compute_subnetwork.subnet.name

  deletion_protection = false # Set to true in production
}

# ------------------------------------------------------------------------------
# Separately Managed Node Pool
# ------------------------------------------------------------------------------
resource "google_container_node_pool" "primary_nodes" {
  name       = "tiger-claw-node-pool"
  location   = var.zone
  cluster    = google_container_cluster.tiger_claw.name
  node_count = 2 # Starting nodes

  autoscaling {
    min_node_count = 2
    max_node_count = 10
  }

  node_config {
    oauth_scopes = [
      "https://www.googleapis.com/auth/logging.write",
      "https://www.googleapis.com/auth/monitoring",
      "https://www.googleapis.com/auth/devstorage.read_only", # Required to pull from GCR/Artifact Registry if used
    ]

    machine_type = "e2-standard-4"
    tags         = ["gke-node", "tiger-claw-cluster"]
    metadata = {
      disable-legacy-endpoints = "true"
    }
  }
}

# ------------------------------------------------------------------------------
# Network / VPC
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
}

# ------------------------------------------------------------------------------
# Cloud SQL (PostgreSQL Shared DB)
# ------------------------------------------------------------------------------
resource "google_sql_database_instance" "master" {
  name             = "tiger-claw-postgres"
  database_version = "POSTGRES_15"
  region           = var.region
  deletion_protection = false # Set to true in production

  settings {
    tier = "db-f1-micro" # Update for production
    ip_configuration {
      ipv4_enabled    = true
      private_network = google_compute_network.vpc.id
    }
  }
}

resource "google_sql_database" "database" {
  name     = "tiger_claw_shared"
  instance = google_sql_database_instance.master.name
}

resource "google_sql_user" "users" {
  name     = "tiger_claw_admin"
  instance = google_sql_database_instance.master.name
  password = var.db_password
}
