# Container registry — used once the deployment target moves off Fly.io's
# own registry (infra/docker/fly.*.toml) to EKS/ECS. One repo per app so
# lifecycle/scan policies and access can differ (e.g. apps/admin is more
# sensitive than apps/web).
locals {
  ecr_repos = ["api", "web", "ws-gateway", "workers", "admin"]
}

resource "aws_ecr_repository" "app" {
  for_each = toset(local.ecr_repos)

  name                 = "x/${each.value}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = { Name = "x-${each.value}" }
}

resource "aws_ecr_lifecycle_policy" "app" {
  for_each   = aws_ecr_repository.app
  repository = each.value.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 20 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 20
      }
      action = { type = "expire" }
    }]
  })
}
