'use client'

import { cn } from '@/lib/cn'
import {
  mediaGridContainerClassName,
  mediaGridItemClassName,
  singleImageAspectRatio,
} from '@/lib/media-grid-layout'
import type { PostMediaItem } from '@x/contracts'
import { decode } from 'blurhash'
import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'

// ROADMAP.md 2.7's player bullet: "carga diferida (dynamic())" — a page
// with no GIF/video media never loads this component (or, one level
// deeper, hls.js — see lazy-video-player.tsx's own docstring) at all.
const LazyVideoPlayer = dynamic(() => import('./lazy-video-player.js'), { ssr: false })

type MediaGridProps = {
  media: PostMediaItem[]
}

/** SPECS.md §7.2: 1–4 images, `aspect-ratio` CSS, blurhash placeholders. */
export function MediaGrid({ media }: MediaGridProps) {
  if (media.length === 0) return null
  const count = media.length

  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border border-border',
        mediaGridContainerClassName(count),
      )}
    >
      {media.map((item, index) => (
        <MediaGridItem
          key={item.id}
          item={item}
          className={mediaGridItemClassName(count, index)}
          aspectRatio={
            count === 1 ? singleImageAspectRatio(item.width ?? 1, item.height ?? 1) : undefined
          }
        />
      ))}
    </div>
  )
}

const BLURHASH_SAMPLE_SIZE = 32

function MediaGridItem({
  item,
  className,
  aspectRatio,
}: {
  item: PostMediaItem
  className: string
  aspectRatio: number | undefined
}) {
  const [placeholderUrl, setPlaceholderUrl] = useState<string | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)

  useEffect(() => {
    // Rendering a blurhash to a data URL is DOM computation from a prop, not
    // a data fetch — same category as Timeline's scroll-margin effect
    // (CODESTYLE.md §11 only forbids useEffect for *fetching*).
    if (!item.blurhash) return
    const canvas = document.createElement('canvas')
    canvas.width = BLURHASH_SAMPLE_SIZE
    canvas.height = BLURHASH_SAMPLE_SIZE
    const context = canvas.getContext('2d')
    if (!context) return
    const pixels = decode(item.blurhash, BLURHASH_SAMPLE_SIZE, BLURHASH_SAMPLE_SIZE)
    const imageData = context.createImageData(BLURHASH_SAMPLE_SIZE, BLURHASH_SAMPLE_SIZE)
    imageData.data.set(pixels)
    context.putImageData(imageData, 0, 0)
    setPlaceholderUrl(canvas.toDataURL())
  }, [item.blurhash])

  return (
    <div
      className={cn('relative bg-muted', className)}
      style={aspectRatio ? { aspectRatio } : undefined}
    >
      {placeholderUrl && (
        <img
          src={placeholderUrl}
          alt=""
          aria-hidden="true"
          className={cn(
            'absolute inset-0 h-full w-full object-cover transition-opacity duration-300',
            isLoaded ? 'opacity-0' : 'opacity-100',
          )}
        />
      )}
      {item.kind === 'image' ? (
        <img
          src={item.url}
          alt={item.altText ?? 'Imagen adjunta'}
          loading="lazy"
          onLoad={() => setIsLoaded(true)}
          className={cn(
            'relative h-full w-full object-cover transition-opacity duration-300',
            isLoaded ? 'opacity-100' : 'opacity-0',
          )}
        />
      ) : (
        // No onLoad-driven fade here the way the image branch above has —
        // <video poster> has no equivalent "the poster image finished
        // downloading" DOM event to hook without preloading it by hand, and
        // the player's own poster/controls already sit visually on top of
        // the blurhash placeholder immediately, so there's no blank gap to
        // paper over the way an unstyled bare <img> would leave one.
        <div className="relative h-full w-full">
          <LazyVideoPlayer
            url={item.url}
            posterUrl={item.posterUrl}
            kind={item.kind}
            altText={item.altText}
          />
        </div>
      )}
    </div>
  )
}
