variable "aws_region" {
  description = "AWS region for all resources."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment name (staging, production)."
  type        = string
  default     = "staging"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "AZs to spread subnets across — at least 2 for RDS Multi-AZ."
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
}

variable "db_instance_class" {
  description = "RDS instance class. db.t4g.micro is enough until real traffic lands."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_name" {
  description = "Default database name."
  type        = string
  default     = "x"
}

variable "db_username" {
  description = "Master username for RDS — the password is generated and stored in Secrets Manager, never in state as plaintext."
  type        = string
  default     = "x_admin"
}

variable "redis_node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t4g.micro"
}
