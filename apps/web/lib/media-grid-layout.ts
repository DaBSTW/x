// Pure layout math for <MediaGrid> (SPECS.md §7.2), split out from the
// component itself so it's testable without jsdom/canvas — same rationale
// as lib/format.ts.

const MIN_SINGLE_ASPECT_RATIO = 0.5 // 1:2, tallest a solo image is allowed to render
const MAX_SINGLE_ASPECT_RATIO = 1.91 // matches the classic link-card cap

/** Clamps a single attached image's own width/height ratio so an extreme (near-strip) photo can't blow out the timeline's layout. */
export function singleImageAspectRatio(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 1
  return Math.min(MAX_SINGLE_ASPECT_RATIO, Math.max(MIN_SINGLE_ASPECT_RATIO, width / height))
}

/** Grid container classes for 1–4 images — 2/3/4 share a fixed 16:9 frame (X's own convention); a single image keeps its own ratio instead. */
export function mediaGridContainerClassName(count: number): string {
  if (count <= 1) return 'grid grid-cols-1'
  if (count === 2) return 'grid grid-cols-2 grid-rows-1 gap-0.5 aspect-[16/9]'
  return 'grid grid-cols-2 grid-rows-2 gap-0.5 aspect-[16/9]'
}

/** Per-item classes within the grid — only the 3-image layout needs one image to span both rows (one big + two stacked). */
export function mediaGridItemClassName(count: number, index: number): string {
  return count === 3 && index === 0 ? 'row-span-2' : ''
}
