'use client'

import { usePrefersReducedMotion } from '@/lib/use-reduced-motion'
import { useEffect, useRef, useState } from 'react'

export type LazyVideoPlayerProps = {
  /** A GIF's own MP4, or a video's HLS *master* playlist — never a specific rendition. */
  url: string
  posterUrl: string | null
  kind: 'gif' | 'video'
  altText: string | null
}

/**
 * media-grid.tsx loads this component itself via `next/dynamic`
 * (`ssr: false`) — that's the "carga diferida" ROADMAP.md 2.7's player
 * bullet names, so a page with no GIF/video media never pays for this file
 * at all. `hls.js` goes one lazy step further, inside `attachSource` below:
 * a plain `import`, even a dynamically-loaded *component's* own top-level
 * one, still lands in that component's chunk — attaching a real playback
 * source (below) only imports it the moment a video that actually needs it
 * (a non-Safari browser, an HLS master playlist) is about to play, never
 * for a GIF's own MP4, which every browser already plays natively.
 *
 * GIF (`kind:'gif'`) replicates real GIF behavior — autoplays muted,
 * looped, no controls — *unless* `prefers-reduced-motion` is set, in which
 * case it falls back to the same poster-first, tap-to-play behavior as
 * video. Video (`kind:'video'`) never autoplays regardless of motion
 * preference: starting an unrelated clip's motion (and potential audio)
 * the instant it scrolls into view is the more disruptive of the two
 * defaults, so it always waits for an explicit tap.
 */
export default function LazyVideoPlayer({ url, posterUrl, kind, altText }: LazyVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const attachedRef = useRef(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const prefersReducedMotion = usePrefersReducedMotion()
  const autoplayGif = kind === 'gif' && !prefersReducedMotion

  useEffect(() => {
    if (!autoplayGif) return
    const video = videoRef.current
    if (!video) return
    let cancelled = false
    void attachSource(video, url).then(() => {
      // The effect's own cleanup can fire before the async attach settles
      // (a fast unmount) — never call .play() on a component that's
      // already gone.
      if (cancelled) return
      video.play().catch(() => {
        // Autoplay can still be blocked by the browser itself (e.g. data
        // saver mode) even when muted — the poster stays visible either
        // way, never a broken-looking blank player.
      })
      setIsPlaying(true)
    })
    return () => {
      cancelled = true
    }
  }, [autoplayGif, url])

  function handlePlayClick(): void {
    const video = videoRef.current
    if (!video) return
    void attachSource(video, url).then(() => {
      video.play().catch(() => {})
      setIsPlaying(true)
    })
  }

  async function attachSource(video: HTMLVideoElement, source: string): Promise<void> {
    if (attachedRef.current) return
    attachedRef.current = true

    if (!source.endsWith('.m3u8') || video.canPlayType('application/vnd.apple.mpegurl')) {
      // A GIF's own MP4, or an HLS playlist on a browser with native
      // support (Safari) — no hls.js involved either way.
      video.src = source
      return
    }

    const { default: Hls } = await import('hls.js')
    if (!Hls.isSupported()) {
      video.src = source // Last-resort direct attempt on an unsupported browser.
      return
    }
    await new Promise<void>((resolve) => {
      const hls = new Hls()
      hls.loadSource(source)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => resolve())
    })
  }

  return (
    <div className="relative h-full w-full bg-black">
      <video
        ref={videoRef}
        poster={posterUrl ?? undefined}
        muted={kind === 'gif'}
        loop={kind === 'gif'}
        playsInline
        controls={isPlaying && kind === 'video'}
        aria-label={altText ?? (kind === 'gif' ? 'GIF animado' : 'Vídeo')}
        className="h-full w-full object-cover"
      />
      {!isPlaying && (
        <button
          type="button"
          onClick={handlePlayClick}
          aria-label="Reproducir"
          className="absolute inset-0 flex items-center justify-center bg-black/10 text-white transition-colors hover:bg-black/20"
        >
          <svg viewBox="0 0 24 24" width="48" height="48" aria-hidden="true">
            <circle cx="12" cy="12" r="11" fill="currentColor" fillOpacity="0.55" />
            <path d="M10 8l6 4-6 4z" fill="white" />
          </svg>
        </button>
      )}
    </div>
  )
}
