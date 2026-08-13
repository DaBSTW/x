import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  HLS_RENDITION_LADDER,
  type HlsRenditionSpec,
  mediaHlsRenditionPlaylistKey,
  mediaHlsSegmentKeyPrefix,
  probeVideo,
} from '@x/utils'
import { runFfmpeg } from './ffmpeg-runner.js'

export type VideoTranscodeFile = { key: string; buffer: Buffer }

export type VideoRenditionResult = {
  height: number
  width: number
  bandwidthBps: number
  playlistKey: string
  /** The rendition's own playlist plus every one of its segments — the caller (media.processor.ts) just uploads each one as-is. */
  files: VideoTranscodeFile[]
}

export type VideoTranscodeResult = {
  width: number
  height: number
  durationMs: number
  poster: Buffer
  masterPlaylistKey: string
  masterPlaylist: string
  renditions: VideoRenditionResult[]
}

const HLS_SEGMENT_SECONDS = 6

/** The smallest ladder rung's own bitrates, reused as the target when a source is smaller than every named rung — SPECS.md §9.2 doesn't define a bitrate for "below 240p", so this is a reasoned fallback, not a guess pulled from nowhere. Floors to an even height (libx264 requires it, same reason gif-transcoder.ts's own scale filter rounds down) — the ladder's own fixed rungs are all already even, only this derived-from-the-source-itself one needs to do it explicitly. */
function fallbackRenditionSpec(sourceHeight: number): HlsRenditionSpec {
  const smallest = HLS_RENDITION_LADDER[0]
  if (!smallest) throw new Error('HLS_RENDITION_LADDER must not be empty')
  return { ...smallest, height: sourceHeight - (sourceHeight % 2) }
}

/**
 * Never upscales past the source's own height — same "orig, never upscaled"
 * principle media.processor.ts already applies to image variants. Unlike
 * images, though, a video can be *smaller* than every named rung (240p is
 * the ladder's own floor) — in that one case this still returns exactly one
 * rendition, at the source's own height, rather than an empty ladder that
 * would leave the video with no playable rendition at all.
 */
function selectRenditionLadder(sourceHeight: number): HlsRenditionSpec[] {
  const withinSource = HLS_RENDITION_LADDER.filter((spec) => spec.height <= sourceHeight)
  return withinSource.length > 0 ? withinSource : [fallbackRenditionSpec(sourceHeight)]
}

/**
 * ROADMAP.md 2.7: "Vídeo → HLS multi-bitrate (240p–1080p), H.264 + AAC".
 * One ffmpeg invocation per rendition (re-decodes the source each time,
 * rather than one process branching into every rendition at once) —
 * simpler to isolate, time out, and attribute a failure to a single
 * rendition than a single multi-output ffmpeg command would be; an
 * optimization for later, not a correctness requirement this checkpoint
 * needs.
 */
export async function transcodeVideo(
  mediaId: string,
  source: Buffer,
): Promise<VideoTranscodeResult> {
  const dir = await mkdtemp(join(tmpdir(), 'x-video-transcode-'))
  try {
    const sourcePath = join(dir, 'source')
    await writeFile(sourcePath, source)

    const sourceProbe = await probeVideo(source)
    if (!sourceProbe) {
      throw new Error('transcodeVideo: could not read dimensions/duration from the source')
    }

    const ladder = selectRenditionLadder(sourceProbe.height)
    const renditions: VideoRenditionResult[] = []
    for (const spec of ladder) {
      renditions.push(await transcodeRendition(mediaId, dir, spec))
    }

    const poster = await extractPoster(dir)
    const masterPlaylistKey = `media/${mediaId}/hls/master.m3u8`
    const masterPlaylist = buildMasterPlaylist(renditions)

    return {
      width: sourceProbe.width,
      height: sourceProbe.height,
      durationMs: sourceProbe.durationMs,
      poster,
      masterPlaylistKey,
      masterPlaylist,
      renditions,
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function transcodeRendition(
  mediaId: string,
  dir: string,
  spec: HlsRenditionSpec,
): Promise<VideoRenditionResult> {
  const relativeDir = `hls/${spec.height}p`
  await mkdir(join(dir, relativeDir), { recursive: true })

  const videoBitrate = `${spec.videoBitrateKbps}k`
  const bufsize = `${spec.videoBitrateKbps * 2}k`
  const audioBitrate = `${spec.audioBitrateKbps}k`
  await runFfmpeg({
    cwd: dir,
    args: [
      '-i',
      'source',
      '-vf',
      `scale=-2:${spec.height}`,
      '-c:v',
      'libx264',
      '-profile:v',
      'main',
      '-crf',
      '20',
      '-maxrate',
      videoBitrate,
      '-bufsize',
      bufsize,
      '-c:a',
      'aac',
      '-b:a',
      audioBitrate,
      '-ac',
      '2',
      '-hls_time',
      String(HLS_SEGMENT_SECONDS),
      '-hls_playlist_type',
      'vod',
      '-hls_segment_filename',
      `${relativeDir}/seg_%03d.ts`,
      `${relativeDir}/playlist.m3u8`,
    ],
  })

  const files = await collectRenditionFiles(mediaId, dir, relativeDir, spec.height)
  const playlistKey = mediaHlsRenditionPlaylistKey(mediaId, spec.height)
  const width = await probeRenditionWidth(dir, relativeDir, spec.height)

  return {
    height: spec.height,
    width,
    bandwidthBps: (spec.videoBitrateKbps + spec.audioBitrateKbps) * 1000,
    playlistKey,
    files,
  }
}

/** ffprobe against the *first segment* — an HLS playlist itself carries no width/height, only its segments do (probeVideo needs a real elementary/container stream to read stream metadata from, and a .ts segment is exactly that). */
async function probeRenditionWidth(
  dir: string,
  relativeDir: string,
  height: number,
): Promise<number> {
  const files = await readdir(join(dir, relativeDir))
  const firstSegment = files.filter((name) => name.endsWith('.ts')).sort()[0]
  if (!firstSegment) throw new Error(`transcodeVideo: rendition ${height}p produced no segments`)
  const buffer = await readFile(join(dir, relativeDir, firstSegment))
  const probed = await probeVideo(buffer)
  if (!probed) throw new Error(`transcodeVideo: could not probe rendition ${height}p's own output`)
  return probed.width
}

async function collectRenditionFiles(
  mediaId: string,
  dir: string,
  relativeDir: string,
  height: number,
): Promise<VideoTranscodeFile[]> {
  const names = await readdir(join(dir, relativeDir))
  const prefix = mediaHlsSegmentKeyPrefix(mediaId, height)
  const files: VideoTranscodeFile[] = []
  for (const name of names) {
    const buffer = await readFile(join(dir, relativeDir, name))
    const key =
      name === 'playlist.m3u8' ? mediaHlsRenditionPlaylistKey(mediaId, height) : `${prefix}${name}`
    files.push({ key, buffer })
  }
  return files
}

async function extractPoster(dir: string): Promise<Buffer> {
  await runFfmpeg({
    cwd: dir,
    args: ['-i', 'source', '-frames:v', '1', '-update', '1', '-c:v', 'libwebp', 'poster.webp'],
  })
  return readFile(join(dir, 'poster.webp'))
}

/**
 * Hand-written, not ffmpeg-generated: producing every rendition as a
 * separate single-bitrate encode (see transcodeVideo's own docstring) means
 * nothing ever asks ffmpeg to emit a *combined* master playlist — RFC 8216's
 * own format is simple enough that this is the standard way real pipelines
 * assemble one from renditions encoded independently.
 */
function buildMasterPlaylist(renditions: VideoRenditionResult[]): string {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3']
  for (const rendition of renditions) {
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${rendition.bandwidthBps},RESOLUTION=${rendition.width}x${rendition.height}`,
      // Relative to master.m3u8's own location (media/{id}/hls/) — exactly
      // where mediaHlsRenditionPlaylistKey's own {height}p/playlist.m3u8
      // sits, so this never needs to know the full key, just its own
      // sibling path.
      `${rendition.height}p/playlist.m3u8`,
    )
  }
  return `${lines.join('\n')}\n`
}
