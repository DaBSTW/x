import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runFfmpeg } from './ffmpeg-runner.js'

// A real ffmpeg (and prlimit) subprocess throughout — same "generate the
// real artifact, don't fake it" posture as every other infra-touching test
// in this repo, just a local binary standing in for a container. CI
// provisions ffmpeg for this file (see ci.yml's `integration` job) — this
// suite deliberately isn't itself an *.integration.test.ts: it never
// touches Postgres/Redis/S3, only a local subprocess and a scratch dir, so
// it stays in the fast `pnpm test` tier apps/workers already has (mirrors
// packages/utils' own video-probe.test.ts).
describe('runFfmpeg', () => {
  let cwd: string

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'x-ffmpeg-runner-'))
  })

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true })
  })

  it('runs a real ffmpeg command to completion and produces the output file', async () => {
    await runFfmpeg({
      cwd,
      args: [
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=1:size=160x120:rate=5',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        'out.mp4',
      ],
    })

    const info = await stat(join(cwd, 'out.mp4'))
    expect(info.size).toBeGreaterThan(0)
  }, 15_000)

  it('rejects with a message built from ffmpeg’s own stderr on a non-zero exit', async () => {
    await expect(
      runFfmpeg({
        cwd,
        // No -f lavfi / no such input file — a real, immediate ffmpeg error,
        // not a contrived one.
        args: ['-i', 'this-file-does-not-exist.mp4', 'out.mp4'],
      }),
    ).rejects.toThrow(/ffmpeg exited with code/)
  }, 15_000)

  it('kills a runaway process once it exceeds the configured timeout, instead of waiting for it to finish', async () => {
    const startedAt = Date.now()
    await expect(
      runFfmpeg({
        cwd,
        // -re paces ffmpeg to real time (~10 real seconds for this clip)
        // instead of "as fast as possible" — the only reliable way to
        // guarantee it's still running when the short timeout below fires,
        // regardless of how fast the host CPU happens to be.
        args: [
          '-re',
          '-f',
          'lavfi',
          '-i',
          'testsrc=duration=10:size=320x240:rate=10',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          'out.mp4',
        ],
        timeoutMs: 300,
      }),
    ).rejects.toThrow(/timed out after 300ms/)
    // Killed well before the source's own 10 real seconds — proves it was
    // the timeout that ended this, not the encode finishing on its own.
    expect(Date.now() - startedAt).toBeLessThan(5000)
  }, 15_000)
})
