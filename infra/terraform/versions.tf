# Forward-looking IaC for the eventual AWS production environment
# (SPECS.md §2.4: Fly.io for early staging — see infra/docker/fly.*.toml and
# .github/workflows/deploy.yml — Kubernetes/managed AWS services once scale
# justifies the operational cost). Not applied yet; kept `terraform validate`
# clean so it's ready when that day comes.
terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state goes here once the AWS account exists — an S3 backend with
  # DynamoDB locking is the standard choice, deliberately not configured
  # with a bucket name yet (that bucket doesn't exist until phase 3/4).
  # backend "s3" {}
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "x"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
