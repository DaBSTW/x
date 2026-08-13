// ROADMAP.md 2.7: "Worker ffmpeg aislado con límites de CPU/memoria y
// timeout de 10 min". Isolation here means every real transcode runs as its
// own child process — never inline in the BullMQ worker's own event loop, so
// a crash or runaway allocation inside ffmpeg can't take the whole consumer
// down with it — under two independent ceilings:
//
// - prlimit(1) (util-linux — already part of the base Debian image
//   apps/workers/Dockerfile builds from, confirmed separately from ffmpeg
//   itself, which the Dockerfile does install explicitly) wraps the spawn
//   with a hard address-space (--as) and CPU-time (--cpu) limit, enforced by
//   the kernel — not something a pathological input could talk ffmpeg out
//   of the way an in-process memory budget might be.
// - A wall-clock timer independently SIGKILLs the process if it hasn't
//   exited after FFMPEG_TIMEOUT_MS (10 min): prlimit's --cpu counts CPU
//   *time*, not wall time, so a process mostly blocked on I/O rather than
//   burning CPU wouldn't otherwise ever hit it.
import { spawn } from 'node:child_process'
import { MEDIA_LIMITS } from '@x/utils'

export type FfmpegRunOptions = {
  /** Everything after the binary name — never includes `-y`/`-nostdin`, runFfmpeg always adds those itself. */
  args: string[]
  /** Working directory ffmpeg's own relative output paths (an HLS rendition's segment names, a poster file) resolve against. */
  cwd: string
  /** Overrides MEDIA_LIMITS.FFMPEG_TIMEOUT_MS — exists so ffmpeg-runner.test.ts can prove the kill-after-timeout path in milliseconds instead of the real 10 min budget; every real caller in this codebase leaves it unset. */
  timeoutMs?: number
}

const MAX_CAPTURED_STDERR_BYTES = 16 * 1024

/** Rejects with ffmpeg's own captured stderr tail on a non-zero exit, or a dedicated timeout error if it was killed for running past the wall-clock budget instead. */
export function runFfmpeg(options: FfmpegRunOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'prlimit',
      [
        `--as=${MEDIA_LIMITS.FFMPEG_MAX_MEMORY_BYTES}`,
        `--cpu=${MEDIA_LIMITS.FFMPEG_MAX_CPU_SECONDS}`,
        '--',
        'ffmpeg',
        '-y',
        '-nostdin',
        ...options.args,
      ],
      { cwd: options.cwd, stdio: ['ignore', 'ignore', 'pipe'] },
    )

    let stderr = ''
    let timedOut = false
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_CAPTURED_STDERR_BYTES) stderr += chunk.toString()
    })

    const timeoutMs = options.timeoutMs ?? MEDIA_LIMITS.FFMPEG_TIMEOUT_MS
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)

    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve()
      } else if (timedOut) {
        reject(new Error(`ffmpeg timed out after ${timeoutMs}ms`))
      } else {
        reject(new Error(`ffmpeg exited with code ${String(code)}: ${stderr.slice(-2000)}`))
      }
    })
  })
}
