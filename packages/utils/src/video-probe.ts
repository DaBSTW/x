// Shared between apps/api (synchronous finalize-time validation) and
// apps/workers (deciding the HLS rendition ladder before transcoding) — same
// "shared I/O helper, not just shared types" precedent as s3.ts. Lives here
// rather than only in apps/workers because apps/api needs its own answer
// *before* enqueueing anything (ROADMAP.md 1.5's "valida síncrono, feedback
// inmediato", extended to video in 2.7): ffprobe only reads a container's
// own duration/dimension metadata, it never decodes a frame, so even a
// 512 MB file resolves in well under a second — fast enough to run inline
// in a request handler, unlike the real transcode apps/workers' own
// ffmpeg-runner.ts isolates with CPU/memory limits and a 10 min timeout.
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type VideoProbeResult = {
  durationMs: number
  width: number
  height: number
}

const PROBE_TIMEOUT_MS = 10_000

/**
 * Returns `null` for anything ffprobe can't read a duration and a video
 * stream's dimensions from — a corrupt file, or one whose magic bytes
 * merely resembled MP4/MOV/WebM without actually being a valid container
 * (detectVideoMimeType only sniffs the header, this is the real parse).
 */
export async function probeVideo(buffer: Buffer): Promise<VideoProbeResult | null> {
  const dir = await mkdtemp(join(tmpdir(), 'x-video-probe-'))
  const path = join(dir, 'input')
  try {
    await writeFile(path, buffer)
    const stdout = await runFfprobe(path)
    return parseProbeOutput(stdout)
  } catch {
    return null
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function parseProbeOutput(stdout: string): VideoProbeResult | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { format, streams } = parsed as {
    format?: { duration?: string }
    streams?: Array<{ width?: number; height?: number; codec_type?: string }>
  }

  const seconds = format?.duration ? Number(format.duration) : null
  const videoStream = streams?.find((stream) => stream.codec_type === 'video')
  if (seconds === null || !Number.isFinite(seconds) || !videoStream?.width || !videoStream.height) {
    return null
  }
  return {
    durationMs: Math.round(seconds * 1000),
    width: videoStream.width,
    height: videoStream.height,
  }
}

/**
 * Writes the buffer to a real file first rather than piping it over stdin:
 * an MP4 whose `moov` atom sits at the end of the file (any file that
 * hasn't been through a "faststart" remux — the common case for a fresh
 * upload) needs ffprobe to seek backward to find its own duration, which a
 * non-seekable stdin pipe can't do.
 */
function runFfprobe(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=width,height,codec_type',
      '-of',
      'json',
      path,
    ])
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
    }, PROBE_TIMEOUT_MS)

    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(`ffprobe exited with code ${String(code)}: ${stderr}`))
      }
    })
  })
}
