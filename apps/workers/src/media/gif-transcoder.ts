import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { probeVideo } from '@x/utils'
import { runFfmpeg } from './ffmpeg-runner.js'

export type GifTranscodeResult = {
  mp4: Buffer
  poster: Buffer
  width: number
  height: number
  durationMs: number
}

/**
 * ROADMAP.md 2.7: "GIF → MP4 (H.264) con loop + poster WebP". An MP4 has no
 * native infinite-loop flag the way a GIF does — "loop" is the *player's*
 * job (the frontend's `<video loop>`, ROADMAP.md 2.7's own player bullet),
 * so what this step owns is producing a clean MP4 that loops with no
 * visible seam and starts playing the instant enough bytes have downloaded:
 * `-movflags faststart` moves the moov atom to the front of the file for
 * exactly that. `scale=trunc(iw/2)*2:trunc(ih/2)*2` rounds each dimension
 * down to even — libx264 requires it, and a real animated GIF's own
 * dimensions aren't guaranteed to already be even. `-an`: a GIF never has
 * audio (the format doesn't support it), so the output shouldn't either,
 * even though ffmpeg would already omit an absent audio stream on its own.
 */
export async function transcodeGif(source: Buffer): Promise<GifTranscodeResult> {
  const dir = await mkdtemp(join(tmpdir(), 'x-gif-transcode-'))
  try {
    await writeFile(join(dir, 'source.gif'), source)

    await runFfmpeg({
      cwd: dir,
      args: [
        '-i',
        'source.gif',
        '-movflags',
        'faststart',
        '-pix_fmt',
        'yuv420p',
        '-vf',
        'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:v',
        'libx264',
        '-crf',
        '23',
        '-an',
        'output.mp4',
      ],
    })
    await runFfmpeg({
      cwd: dir,
      args: [
        '-i',
        'source.gif',
        '-frames:v',
        '1',
        '-update',
        '1',
        '-c:v',
        'libwebp',
        'poster.webp',
      ],
    })

    const [mp4, poster] = await Promise.all([
      readFile(join(dir, 'output.mp4')),
      readFile(join(dir, 'poster.webp')),
    ])

    const probed = await probeVideo(mp4)
    if (!probed) {
      throw new Error(
        'transcodeGif: could not read dimensions/duration back from the transcoded MP4',
      )
    }

    return {
      mp4,
      poster,
      width: probed.width,
      height: probed.height,
      durationMs: probed.durationMs,
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
