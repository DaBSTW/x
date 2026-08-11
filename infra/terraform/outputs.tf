output "vpc_id" {
  value = aws_vpc.main.id
}

output "db_endpoint" {
  value       = aws_db_instance.main.endpoint
  description = "Connect via DATABASE_URL built from this + the Secrets Manager password, never hardcoded."
  sensitive   = true
}

output "redis_endpoint" {
  value     = aws_elasticache_replication_group.main.primary_endpoint_address
  sensitive = true
}

output "media_bucket" {
  value = aws_s3_bucket.media.bucket
}

output "ecr_repository_urls" {
  value = { for name, repo in aws_ecr_repository.app : name => repo.repository_url }
}
