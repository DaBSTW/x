import { type S3Config, createS3Client, getObjectBuffer, putObjectBuffer } from '@x/utils'
import type { MediaStorage } from '../media/media.processor.js'

/** Adapts @x/utils' free S3 functions to the narrow MediaStorage interface media.processor.ts depends on — keeps the processor's unit tests free of any real AWS SDK object, same reason apps/api/src/lib/media-storage.ts exists. */
export function createMediaStorage(config: S3Config): MediaStorage {
  const client = createS3Client(config)
  return {
    getObjectBuffer: (bucket, key) => getObjectBuffer(client, bucket, key),
    putObjectBuffer: (bucket, key, body, contentType) =>
      putObjectBuffer(client, bucket, key, body, contentType),
  }
}
