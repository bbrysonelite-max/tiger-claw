variable "project_id" {
  description = "Google Cloud Project ID"
  type        = string
  default     = "hybrid-matrix-472500-k5"
}

variable "project_hash" {
  description = "Cloud Run URL hash suffix (found after first deploy)"
  type        = string
  default     = "uc" # placeholder — will be known after first deploy
}

variable "region" {
  description = "GCP Region for Cloud Run, SQL, and Redis"
  type        = string
  default     = "us-central1"
}

variable "db_password" {
  description = "Password for the PostgreSQL admin user"
  type        = string
  sensitive   = true
}
