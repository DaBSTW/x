# Redis 7 (SPECS.md §2.3) — timelines, rate limiting, sessions, BullMQ.
# Single node for staging; production wants cluster mode once the ~30-40GB
# estimate in SPECS.md §6.3 stops being a projection.

resource "aws_elasticache_subnet_group" "main" {
  name       = "x-${var.environment}-redis"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_security_group" "redis" {
  name        = "x-${var.environment}-redis"
  description = "Allow Redis from the app's security group only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Redis from app"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "x-${var.environment}-redis-sg" }
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "x-${var.environment}"
  description          = "X ${var.environment} Redis"

  engine         = "redis"
  engine_version = "7.1"
  node_type      = var.redis_node_type

  num_cache_clusters         = var.environment == "production" ? 2 : 1
  automatic_failover_enabled = var.environment == "production"

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true

  tags = { Name = "x-${var.environment}-redis" }
}
