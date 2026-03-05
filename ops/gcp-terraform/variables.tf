variable "project_id" {
  description = "Google Cloud Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region for the cluster and database"
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "GCP Zone for the GKE cluster"
  type        = string
  default     = "us-central1-a"
}

variable "db_password" {
  description = "Password for the PostgreSQL admin user"
  type        = string
  sensitive   = true
}
