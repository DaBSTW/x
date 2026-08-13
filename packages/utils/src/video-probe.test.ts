import { spawn } from 'node:child_process'
import { beforeAll, describe, expect, it } from 'vitest'
import { probeVideo } from './video-probe.js'

/**
 * A real ffmpeg subprocess, not a checked-in binary fixture — same
 * "generate the real artifact, don't fake it" posture as every other
 * infra-touching test in this repo, just with a local binary standing in
 * for a container. CI provisions ffmpeg for exactly this file (see ci.yml's
 * `test` job) — the same real ffprobe apps/workers' own transcoders and
 * apps/api's finalize-time validation both shell out to.
 */
function ffmpeg(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-y', ...args, '-f', 'mp4', '-movflags', 'frag_keyframe', '-'])
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks))
      else reject(new Error(`ffmpeg exited with code ${String(code)}`))
    })
  })
}

describe('probeVideo', () => {
  let realMp4: Buffer

  beforeAll(async () => {
    realMp4 = await ffmpeg([
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=2:size=320x240:rate=10',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
    ])
  }, 30_000)

  it('reads duration and dimensions from a real MP4', async () => {
    const result = await probeVideo(realMp4)
    expect(result).not.toBeNull()
    expect(result?.width).toBe(320)
    expect(result?.height).toBe(240)
    // lavfi's testsrc duration is exact, but container/keyframe rounding
    // can shift it by a frame or two either way — assert a tight window,
    // not an exact millisecond count.
    expect(result?.durationMs).toBeGreaterThan(1800)
    expect(result?.durationMs).toBeLessThan(2200)
  })

  it('returns null for a buffer that is not a real video, even if it happens to start with plausible bytes', async () => {
    const notActuallyAVideo = Buffer.from('this is not a video file at all')
    expect(await probeVideo(notActuallyAVideo)).toBeNull()
  })

  it('returns null for an empty buffer', async () => {
    expect(await probeVideo(Buffer.alloc(0))).toBeNull()
  })
})
