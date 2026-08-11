import { describe, expect, it } from 'vitest'
import {
  mediaGridContainerClassName,
  mediaGridItemClassName,
  singleImageAspectRatio,
} from './media-grid-layout'

describe('singleImageAspectRatio', () => {
  it('keeps a normal landscape ratio as-is', () => {
    expect(singleImageAspectRatio(1600, 900)).toBeCloseTo(16 / 9)
  })

  it('caps an extremely wide panorama at 1.91:1', () => {
    expect(singleImageAspectRatio(4000, 500)).toBe(1.91)
  })

  it('caps an extremely tall image at 1:2', () => {
    expect(singleImageAspectRatio(500, 4000)).toBe(0.5)
  })

  it('falls back to square for a missing dimension', () => {
    expect(singleImageAspectRatio(0, 0)).toBe(1)
  })
})

describe('mediaGridContainerClassName', () => {
  it('gives a single image its own column, no fixed aspect ratio', () => {
    expect(mediaGridContainerClassName(1)).toBe('grid grid-cols-1')
  })

  it('splits two images into a 16:9 row', () => {
    expect(mediaGridContainerClassName(2)).toBe(
      'grid grid-cols-2 grid-rows-1 gap-0.5 aspect-[16/9]',
    )
  })

  it('shares the same 2x2 16:9 frame for three and four images', () => {
    expect(mediaGridContainerClassName(3)).toBe(
      'grid grid-cols-2 grid-rows-2 gap-0.5 aspect-[16/9]',
    )
    expect(mediaGridContainerClassName(4)).toBe(
      'grid grid-cols-2 grid-rows-2 gap-0.5 aspect-[16/9]',
    )
  })
})

describe('mediaGridItemClassName', () => {
  it('spans the first of three images across both rows', () => {
    expect(mediaGridItemClassName(3, 0)).toBe('row-span-2')
  })

  it('leaves the other two images in three as single cells', () => {
    expect(mediaGridItemClassName(3, 1)).toBe('')
    expect(mediaGridItemClassName(3, 2)).toBe('')
  })

  it('leaves every four-image cell as a plain grid cell', () => {
    expect(mediaGridItemClassName(4, 0)).toBe('')
    expect(mediaGridItemClassName(4, 3)).toBe('')
  })
})
