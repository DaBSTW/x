import {
  type S3Config,
  createPresignedUploadUrl,
  createS3Client,
  deleteObject,
  getObjectBuffer,
  headObjectSize,
} from '@x/utils'
import type { MediaStorage } from '../modules/media/media.service.js'

/** Adapts @x/utils' free S3 functions (which take a raw S3Client) to the narrow MediaStorage interface media.service.ts depends on — keeps the service's unit tests free of any real AWS SDK object. */
export function createMediaStorage(config: S3Config): MediaStorage {
  const client = createS3Client(config)
  return {
    createPresignedUploadUrl: (bucket, key, contentType) =>
      createPresignedUploadUrl(client, bucket, key, contentType),
    headObjectSize: (bucket, key) => headObjectSize(client, bucket, key),
    getObjectBuffer: (bucket, key) => getObjectBuffer(client, bucket, key),
    deleteObject: (bucket, key) => deleteObject(client, bucket, key),
  }
}
