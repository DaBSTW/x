# Media storage (SPECS.md §9) — images, video, avatars/banners. Versioned so
# a bad transcode or accidental overwrite doesn't lose the original, with a
# lifecycle rule moving old versions to Glacier rather than deleting them.
resource "aws_s3_bucket" "media" {
  bucket = "x-${var.environment}-media"
  tags   = { Name = "x-${var.environment}-media" }
}

resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "media" {
  bucket = aws_s3_bucket.media.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  rule {
    id     = "old-versions-to-glacier"
    status = "Enabled"
    filter {}

    noncurrent_version_transition {
      noncurrent_days = 90
      storage_class   = "GLACIER"
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "media" {
  bucket = aws_s3_bucket.media.id

  cors_rule {
    allowed_methods = ["PUT", "GET"]
    allowed_origins = ["https://*.example.com"]
    allowed_headers = ["*"]
    max_age_seconds = 3000
  }
}
