import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateId } from '@x/utils'
import { describe, expect, it } from 'vitest'
import { transcodeVideo } from './video-transcoder.js'

/** A real ffmpeg subprocess generates each fixture — same reasoning as ffmpeg-runner.test.ts and gif-transcoder.test.ts. */
function ffmpegToFile(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-y', ...args])
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)),
    )
  })
}

async function buildFixture(size: string, seconds: number): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'x-video-fixture-'))
  const path = join(dir, 'fixture.mp4')
  await ffmpegToFile([
    '-f',
    'lavfi',
    '-i',
    `testsrc=duration=${seconds}:size=${size}:rate=10`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${seconds}`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    path,
  ])
  const buffer = await readFile(path)
  await rm(dir, { recursive: true, force: true })
  return buffer
}

describe('transcodeVideo', () => {
  it('produces one rendition per ladder rung at or below the source height, plus a master playlist referencing all of them', async () => {
    // 640x480 clears the 240p/360p/480p rungs but not 720p/1080p — a
    // meaningful multi-bitrate test (more than one rendition) without the
    // encode time a real 1080p source would cost.
    const source = await buildFixture('640x480', 2)
    const mediaId = generateId().toString()

    const result = await transcodeVideo(mediaId, source)

    expect(result.width).toBe(640)
    expect(result.height).toBe(480)
    expect(result.durationMs).toBeGreaterThan(1700)
    expect(result.durationMs).toBeLessThan(2300)

    const heights = result.renditions.map((rendition) => rendition.height).sort((a, b) => a - b)
    expect(heights).toEqual([240, 360, 480])
    // Never upscaled past the source — SPECS.md §9.2's ladder tops out at
    // 1080p, but this source only clears 480p.
    expect(result.renditions.some((r) => r.height > 480)).toBe(false)

    for (const rendition of result.renditions) {
      expect(rendition.width % 2).toBe(0)
      expect(rendition.bandwidthBps).toBeGreaterThan(0)
      expect(rendition.files.length).toBeGreaterThan(1) // playlist + at least one segment
      expect(rendition.files.some((file) => file.key === rendition.playlistKey)).toBe(true)
      expect(rendition.playlistKey).toBe(`media/${mediaId}/hls/${rendition.height}p/playlist.m3u8`)
    }

    expect(result.masterPlaylistKey).toBe(`media/${mediaId}/hls/master.m3u8`)
    expect(result.masterPlaylist).toContain('#EXTM3U')
    for (const rendition of result.renditions) {
      expect(result.masterPlaylist).toContain(`${rendition.height}p/playlist.m3u8`)
      expect(result.masterPlaylist).toContain(`RESOLUTION=${rendition.width}x${rendition.height}`)
    }

    expect(result.poster.length).toBeGreaterThan(0)
  }, 60_000)

  it('falls back to exactly one rendition at the source height when the source is smaller than the smallest ladder rung', async () => {
    // 160x100 clears no named rung (the ladder floors at 240p) — proves the
    // "never leave a tiny video with zero playable renditions" fallback.
    const source = await buildFixture('160x100', 1)
    const mediaId = generateId().toString()

    const result = await transcodeVideo(mediaId, source)

    expect(result.renditions).toHaveLength(1)
    expect(result.renditions[0]?.height).toBe(100)
  }, 30_000)
})
