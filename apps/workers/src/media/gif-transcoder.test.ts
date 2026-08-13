import { spawn } from 'node:child_process'
import { detectImageMimeType } from '@x/utils'
import { beforeAll, describe, expect, it } from 'vitest'
import { transcodeGif } from './gif-transcoder.js'

/** A real ffmpeg subprocess generates the fixture — same reasoning as ffmpeg-runner.test.ts and packages/utils' video-probe.test.ts: this is exactly the tool the code under test itself shells out to, not a stand-in for it. */
function ffmpegToFile(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-y', ...args])
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)),
    )
  })
}

describe('transcodeGif', () => {
  let animatedGif: Buffer

  beforeAll(async () => {
    const { mkdtemp, readFile, rm } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = await mkdtemp(join(tmpdir(), 'x-gif-fixture-'))
    const path = join(dir, 'fixture.gif')
    // Odd width (161) on purpose — proves transcodeGif's own even-rounding
    // (libx264 requires it) actually does something, not just pass through
    // an already-even source.
    await ffmpegToFile([
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=1:size=161x121:rate=8',
      '-vf',
      'fps=8',
      path,
    ])
    animatedGif = await readFile(path)
    await rm(dir, { recursive: true, force: true })
  }, 30_000)

  it('produces a real, playable MP4 with even dimensions rounded down from an odd-sized source', async () => {
    const result = await transcodeGif(animatedGif)

    expect(result.width).toBe(160)
    expect(result.height).toBe(120)
    expect(result.width % 2).toBe(0)
    expect(result.height % 2).toBe(0)
    expect(result.durationMs).toBeGreaterThan(800)
    expect(result.durationMs).toBeLessThan(1400)
    expect(result.mp4.length).toBeGreaterThan(0)
  }, 30_000)

  it('produces a real WebP poster frame', async () => {
    const result = await transcodeGif(animatedGif)
    expect(detectImageMimeType(result.poster)).toBe('image/webp')
  }, 30_000)
})
