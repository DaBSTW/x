import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export type S3Config = {
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  // MinIO needs path-style addressing (bucket in the URL path); a real S3
  // endpoint in production typically wants virtual-hosted-style instead —
  // see .env.example's S3_FORCE_PATH_STYLE.
  forcePathStyle: boolean
}

const PRESIGNED_UPLOAD_TTL_SECONDS = 5 * 60

/** MinIO in development, any S3-compatible provider in production (SPECS.md §3's `media` service). */
export function createS3Client(config: S3Config): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  })
}

export function createPresignedUploadUrl(
  client: S3Client,
  bucket: string,
  key: string,
  contentType: string,
): Promise<string> {
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType })
  return getSignedUrl(client, command, { expiresIn: PRESIGNED_UPLOAD_TTL_SECONDS })
}

/** `null` when the object doesn't exist — distinguishes "never uploaded" from a genuine error. */
export async function headObjectSize(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<number | null> {
  try {
    const response = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    return response.ContentLength ?? 0
  } catch (error) {
    if (isNotFoundError(error)) return null
    throw error
  }
}

export async function getObjectBuffer(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<Buffer> {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  if (!response.Body) throw new Error(`object ${key} in bucket ${bucket} has no body`)
  return Buffer.from(await response.Body.transformToByteArray())
}

export async function putObjectBuffer(
  client: S3Client,
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  )
}

export async function deleteObject(client: S3Client, bucket: string, key: string): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}

/** `publicUrlBase` is deliberately separate from `endpoint`: the address this process uses to reach S3/MinIO internally (e.g. a Docker service name) usually differs from the address a browser needs (a CDN, or MinIO's own public port). */
export function buildPublicUrl(publicUrlBase: string, bucket: string, key: string): string {
  return `${publicUrlBase.replace(/\/+$/, '')}/${bucket}/${key}`
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error.name === 'NotFound' || error.name === 'NoSuchKey')
  )
}
