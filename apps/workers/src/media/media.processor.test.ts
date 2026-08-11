import { generateId } from '@x/utils'
import sharp from 'sharp'
import { beforeEach, describe, expect, it } from 'vitest'
import { type MediaStorage, createMediaProcessor } from './media.processor.js'
import type { MediaRepository, MediaRow } from './media.repository.js'

const BUCKET = 'test-bucket'

function createFakeStorage() {
  const objects = new Map<string, Buffer>()
  const storage: MediaStorage = {
    async getObjectBuffer(_bucket, key) {
      const buffer = objects.get(key)
      if (!buffer) throw new Error(`no object at ${key}`)
      return buffer
    },
    async putObjectBuffer(_bucket, key, body) {
      objects.set(key, body)
    },
  }
  return { storage, objects }
}

function createFakeRepository(row: MediaRow) {
  const readyCalls: Array<{ id: bigint; result: unknown }> = []
  const failedIds: bigint[] = []
  const repository: MediaRepository = {
    async findMediaById(id) {
      return id === row.id ? row : null
    },
    async markReady(id, result) {
      readyCalls.push({ id, result })
    },
    async markFailed(id) {
      failedIds.push(id)
    },
  }
  return { repository, readyCalls, failedIds }
}

function makeMediaRow(overrides: Partial<MediaRow> = {}): MediaRow {
  return {
    id: generateId(),
    ownerId: generateId(),
    postId: null,
    kind: 'image',
    storageKey: 'media/x/original.png',
    mimeType: 'image/png',
    width: null,
    height: null,
    durationMs: null,
    sizeBytes: 100n,
    blurhash: null,
    altText: null,
    variants: [],
    status: 0,
    createdAt: new Date(),
    ...overrides,
  }
}

describe('createMediaProcessor', () => {
  let storageCtx: ReturnType<typeof createFakeStorage>

  beforeEach(() => {
    storageCtx = createFakeStorage()
  })

  // 8 real encodes at up to 1500px, AVIF included — genuinely CPU-bound, and
  // slow specifically under this monorepo's full parallel build/test run
  // (every package's build and test suite competing for the same cores at
  // once). The default 5s budget is fine standalone; this one needs more
  // room under that contention.
  it('generates every fixed width plus the source width, in both formats, for a large source', async () => {
    const row = makeMediaRow({ storageKey: 'media/big/original.png' })
    storageCtx.objects.set(
      row.storageKey,
      await sharp({ create: { width: 1500, height: 1000, channels: 3, background: '#336699' } })
        .png()
        .toBuffer(),
    )
    const { repository, readyCalls } = createFakeRepository(row)
    const process = createMediaProcessor({
      repository,
      storage: storageCtx.storage,
      bucket: BUCKET,
    })

    await process(row.id.toString())

    expect(readyCalls).toHaveLength(1)
    const result = readyCalls[0]?.result as {
      width: number
      height: number
      variants: unknown[]
    }
    expect(result.width).toBe(1500)
    expect(result.height).toBe(1000)
    // 340, 600, 1200, and 1500 (source width, deduped) × webp/avif = 8.
    expect(result.variants).toHaveLength(8)
  }, 20_000)

  it('never upscales past the source width', async () => {
    const row = makeMediaRow({ storageKey: 'media/small/original.png' })
    storageCtx.objects.set(
      row.storageKey,
      await sharp({ create: { width: 200, height: 100, channels: 3, background: '#ffaa00' } })
        .png()
        .toBuffer(),
    )
    const { repository, readyCalls } = createFakeRepository(row)
    const process = createMediaProcessor({
      repository,
      storage: storageCtx.storage,
      bucket: BUCKET,
    })

    await process(row.id.toString())

    const result = readyCalls[0]?.result as { variants: Array<{ width: number }> }
    // Only "orig" (200) survives — 340/600/1200 all exceed the source width.
    expect(result.variants.map((v) => v.width)).toEqual([200, 200])
  })

  it('applies EXIF orientation to the pixels and strips the tag', async () => {
    const row = makeMediaRow({ storageKey: 'media/rotated/original.jpg', mimeType: 'image/jpeg' })
    // A 100x50 image tagged "needs 90° rotation" should end up 50x100.
    storageCtx.objects.set(
      row.storageKey,
      await sharp({ create: { width: 100, height: 50, channels: 3, background: '#00ff00' } })
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toBuffer(),
    )
    const { repository, readyCalls } = createFakeRepository(row)
    const process = createMediaProcessor({
      repository,
      storage: storageCtx.storage,
      bucket: BUCKET,
    })

    await process(row.id.toString())

    const result = readyCalls[0]?.result as { width: number; height: number }
    expect(result.width).toBe(50)
    expect(result.height).toBe(100)
  })

  it('uploads every generated variant to storage under its own key', async () => {
    const row = makeMediaRow({ storageKey: 'media/upload/original.png' })
    storageCtx.objects.set(
      row.storageKey,
      await sharp({ create: { width: 400, height: 400, channels: 3, background: '#123456' } })
        .png()
        .toBuffer(),
    )
    const { repository } = createFakeRepository(row)
    const process = createMediaProcessor({
      repository,
      storage: storageCtx.storage,
      bucket: BUCKET,
    })

    await process(row.id.toString())

    const uploadedKeys = [...storageCtx.objects.keys()].filter((key) => key !== row.storageKey)
    expect(uploadedKeys).toContain(`media/${row.id}/340.webp`)
    expect(uploadedKeys).toContain(`media/${row.id}/340.avif`)
    expect(uploadedKeys).toContain(`media/${row.id}/400.webp`)
  })

  it('computes a non-empty blurhash', async () => {
    const row = makeMediaRow({ storageKey: 'media/blur/original.png' })
    storageCtx.objects.set(
      row.storageKey,
      await sharp({ create: { width: 300, height: 200, channels: 3, background: '#abcdef' } })
        .png()
        .toBuffer(),
    )
    const { repository, readyCalls } = createFakeRepository(row)
    const process = createMediaProcessor({
      repository,
      storage: storageCtx.storage,
      bucket: BUCKET,
    })

    await process(row.id.toString())

    const result = readyCalls[0]?.result as { blurhash: string }
    expect(result.blurhash.length).toBeGreaterThan(0)
  })

  it('does nothing for a media id that no longer exists', async () => {
    const row = makeMediaRow()
    const { repository, readyCalls, failedIds } = createFakeRepository(row)
    const process = createMediaProcessor({
      repository,
      storage: storageCtx.storage,
      bucket: BUCKET,
    })

    await process(generateId().toString())

    expect(readyCalls).toHaveLength(0)
    expect(failedIds).toHaveLength(0)
  })

  it('propagates the error instead of marking failed, so BullMQ can retry', async () => {
    const row = makeMediaRow({ storageKey: 'media/missing/original.png' })
    // Never seeded in storage — getObjectBuffer will throw.
    const { repository, failedIds } = createFakeRepository(row)
    const process = createMediaProcessor({
      repository,
      storage: storageCtx.storage,
      bucket: BUCKET,
    })

    await expect(process(row.id.toString())).rejects.toThrow()
    expect(failedIds).toHaveLength(0)
  })
})
