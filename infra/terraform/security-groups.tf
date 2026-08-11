# Placeholder security group for whatever compute eventually runs the app
# (ECS tasks, EKS nodes, ...) — referenced by rds.tf and elasticache.tf so
# the data-tier ingress rules exist before the compute layer does. Attach
# real workloads to this group instead of opening RDS/ElastiCache to the
# whole VPC.
resource "aws_security_group" "app" {
  name        = "x-${var.environment}-app"
  description = "Security group for X application compute"
  vpc_id      = aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "x-${var.environment}-app-sg" }
}
