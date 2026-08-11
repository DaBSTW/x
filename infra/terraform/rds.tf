# PostgreSQL 17, matching packages/db's target (SPECS.md §2.3). Password is
# generated and kept only in Secrets Manager — never a plain `variable`
# that would land in .tfvars or state as readable text.

resource "aws_db_subnet_group" "main" {
  name       = "x-${var.environment}-db"
  subnet_ids = aws_subnet.private[*].id
  tags       = { Name = "x-${var.environment}-db-subnet-group" }
}

resource "aws_security_group" "rds" {
  name        = "x-${var.environment}-rds"
  description = "Allow Postgres from the app's security group only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Postgres from app"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "x-${var.environment}-rds-sg" }
}

resource "random_password" "db" {
  length  = 32
  special = false # avoid characters that need extra escaping in connection strings
}

resource "aws_secretsmanager_secret" "db_password" {
  name = "x/${var.environment}/db-password"
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id     = aws_secretsmanager_secret.db_password.id
  secret_string = random_password.db.result
}

resource "aws_db_instance" "main" {
  identifier     = "x-${var.environment}"
  engine         = "postgres"
  engine_version = "17"
  instance_class = var.db_instance_class

  allocated_storage     = 20
  max_allocated_storage = 100 # autoscaling ceiling — avoids a manual resize page at 2am
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = var.db_name
  username = var.db_username
  password = random_password.db.result

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false

  # PITR (RPO 5 min per SPECS.md §16.4) — automated backups plus the
  # transaction logs Postgres already ships give us that for free.
  backup_retention_period = 7
  backup_window           = "03:00-04:00"
  maintenance_window      = "mon:04:30-mon:05:30"

  multi_az            = var.environment == "production"
  deletion_protection = var.environment == "production"
  skip_final_snapshot = var.environment != "production"

  tags = { Name = "x-${var.environment}-postgres" }
}
