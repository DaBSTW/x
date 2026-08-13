import { describe, expect, it } from 'vitest'
import {
  detectGifMimeType,
  detectImageMimeType,
  detectVideoMimeType,
  extensionForMimeType,
  mediaKindForMimeType,
  pickHlsMasterVariant,
  pickMp4Variant,
  pickPosterVariant,
  pickPrimaryVariant,
} from './media.js'

function isobmffBuffer(majorBrand: string): Buffer {
  // size(4) + 'ftyp' + major brand(4) + minor version(4) — the minimum a
  // real file needs before detectImageMimeType even looks past the header.
  return Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from('ftyp', 'ascii'),
    Buffer.from(majorBrand, 'ascii'),
    Buffer.from([0, 0, 0, 0]),
  ])
}

describe('detectImageMimeType', () => {
  it('recognizes a JPEG signature', () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    expect(detectImageMimeType(buffer)).toBe('image/jpeg')
  })

  it('recognizes a PNG signature', () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(detectImageMimeType(buffer)).toBe('image/png')
  })

  it('recognizes a WebP (RIFF/WEBP) signature', () => {
    const buffer = Buffer.concat([
      Buffer.from('RIFF', 'ascii'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('WEBP', 'ascii'),
    ])
    expect(detectImageMimeType(buffer)).toBe('image/webp')
  })

  it('recognizes an AVIF (ISOBMFF ftyp=avif) signature', () => {
    expect(detectImageMimeType(isobmffBuffer('avif'))).toBe('image/avif')
  })

  it('recognizes a HEIC (ISOBMFF ftyp=heic) signature', () => {
    expect(detectImageMimeType(isobmffBuffer('heic'))).toBe('image/heic')
  })

  it('returns null for a file whose bytes match none of the allowed formats', () => {
    const buffer = Buffer.from('#!/bin/sh\necho not an image\n', 'ascii')
    expect(detectImageMimeType(buffer)).toBeNull()
  })

  it('returns null for a Content-Type that lies about a mismatched body', () => {
    // The whole point of the bullet this backs (ROADMAP.md 1.5): a client
    // claiming "image/jpeg" doesn't make arbitrary bytes a JPEG.
    const notActuallyAJpeg = Buffer.from('<html>not an image</html>', 'ascii')
    expect(detectImageMimeType(notActuallyAJpeg)).toBeNull()
  })

  it('returns null for a truncated buffer shorter than any signature', () => {
    expect(detectImageMimeType(Buffer.from([0xff]))).toBeNull()
  })
})

describe('detectGifMimeType', () => {
  it('recognizes a GIF89a signature', () => {
    const buffer = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.from([0, 0, 0, 0])])
    expect(detectGifMimeType(buffer)).toBe('image/gif')
  })

  it('recognizes the older GIF87a signature', () => {
    const buffer = Buffer.from('GIF87a', 'ascii')
    expect(detectGifMimeType(buffer)).toBe('image/gif')
  })

  it('returns null for a Content-Type that lies about a mismatched body', () => {
    expect(detectGifMimeType(Buffer.from('<html>not a gif</html>', 'ascii'))).toBeNull()
  })

  it('returns null for a truncated buffer shorter than the signature', () => {
    expect(detectGifMimeType(Buffer.from('GIF8', 'ascii'))).toBeNull()
  })
})

describe('detectVideoMimeType', () => {
  it('recognizes an MP4 (ISOBMFF ftyp=isom) signature', () => {
    expect(detectVideoMimeType(isobmffBuffer('isom'))).toBe('video/mp4')
  })

  it('classifies any other ftyp major brand as MP4 too, not just an allowlisted few', () => {
    // Real encoders emit dozens of valid major brands (mp42, avc1, M4V , …)
    // — detectVideoMimeType deliberately doesn't allowlist-match one, unlike
    // detectImageMimeType's fixed AVIF/HEIC brand lists.
    expect(detectVideoMimeType(isobmffBuffer('mp42'))).toBe('video/mp4')
  })

  it('recognizes a MOV (ISOBMFF ftyp=qt  ) signature', () => {
    expect(detectVideoMimeType(isobmffBuffer('qt  '))).toBe('video/quicktime')
  })

  it('recognizes a WebM (EBML) signature', () => {
    const buffer = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00])
    expect(detectVideoMimeType(buffer)).toBe('video/webm')
  })

  it('returns null for a Content-Type that lies about a mismatched body', () => {
    expect(detectVideoMimeType(Buffer.from('<html>not a video</html>', 'ascii'))).toBeNull()
  })

  it('returns null for a truncated buffer shorter than any signature', () => {
    expect(detectVideoMimeType(Buffer.from([0x1a]))).toBeNull()
  })
})

describe('mediaKindForMimeType', () => {
  it('maps every image/* mime type to kind image', () => {
    expect(mediaKindForMimeType('image/jpeg')).toBe('image')
    expect(mediaKindForMimeType('image/webp')).toBe('image')
  })

  it('maps image/gif specifically to kind gif, not image', () => {
    expect(mediaKindForMimeType('image/gif')).toBe('gif')
  })

  it('maps every video/* mime type to kind video', () => {
    expect(mediaKindForMimeType('video/mp4')).toBe('video')
    expect(mediaKindForMimeType('video/quicktime')).toBe('video')
    expect(mediaKindForMimeType('video/webm')).toBe('video')
  })
})

describe('extensionForMimeType', () => {
  it('strips the image/ prefix', () => {
    expect(extensionForMimeType('image/webp')).toBe('webp')
    expect(extensionForMimeType('image/jpeg')).toBe('jpeg')
  })

  it('strips the image/ prefix for GIF too', () => {
    expect(extensionForMimeType('image/gif')).toBe('gif')
  })

  it('strips the video/ prefix', () => {
    expect(extensionForMimeType('video/mp4')).toBe('mp4')
    expect(extensionForMimeType('video/webm')).toBe('webm')
  })

  it('maps video/quicktime to the conventional .mov extension, not "quicktime"', () => {
    expect(extensionForMimeType('video/quicktime')).toBe('mov')
  })
})

describe('pickPrimaryVariant', () => {
  it('prefers WebP over AVIF even when AVIF is wider', () => {
    const variants = [
      { width: 1200, format: 'avif' as const },
      { width: 600, format: 'webp' as const },
    ]
    expect(pickPrimaryVariant(variants)).toEqual({ width: 600, format: 'webp' })
  })

  it('picks the widest among same-format variants', () => {
    const variants = [
      { width: 340, format: 'webp' as const },
      { width: 1200, format: 'webp' as const },
      { width: 600, format: 'webp' as const },
    ]
    expect(pickPrimaryVariant(variants)).toEqual({ width: 1200, format: 'webp' })
  })

  it('falls back to AVIF when no WebP variant exists', () => {
    const variants = [{ width: 600, format: 'avif' as const }]
    expect(pickPrimaryVariant(variants)).toEqual({ width: 600, format: 'avif' })
  })

  it('returns undefined for an empty list', () => {
    expect(pickPrimaryVariant([])).toBeUndefined()
  })
})

describe('pickMp4Variant / pickHlsMasterVariant / pickPosterVariant', () => {
  const gifVariants = [
    { format: 'poster' as const, key: 'poster.webp' },
    { format: 'mp4' as const, key: 'gif.mp4' },
  ]
  const videoVariants = [
    { format: 'poster' as const, key: 'poster.webp' },
    { format: 'hls' as const, key: 'hls/240p/playlist.m3u8' },
    { format: 'hls' as const, key: 'hls/1080p/playlist.m3u8' },
    { format: 'hls-master' as const, key: 'hls/master.m3u8' },
  ]

  it('pickMp4Variant finds the mp4 entry a GIF transcodes into', () => {
    expect(pickMp4Variant(gifVariants)).toEqual({ format: 'mp4', key: 'gif.mp4' })
  })

  it('pickMp4Variant returns undefined when there is no mp4 entry (e.g. a video, not a GIF)', () => {
    expect(pickMp4Variant(videoVariants)).toBeUndefined()
  })

  it('pickHlsMasterVariant finds the master playlist, never one of the per-rendition ones', () => {
    expect(pickHlsMasterVariant(videoVariants)).toEqual({
      format: 'hls-master',
      key: 'hls/master.m3u8',
    })
  })

  it('pickPosterVariant finds the poster for either a GIF or a video', () => {
    expect(pickPosterVariant(gifVariants)).toEqual({ format: 'poster', key: 'poster.webp' })
    expect(pickPosterVariant(videoVariants)).toEqual({ format: 'poster', key: 'poster.webp' })
  })

  it('every picker returns undefined for an empty list', () => {
    expect(pickMp4Variant([])).toBeUndefined()
    expect(pickHlsMasterVariant([])).toBeUndefined()
    expect(pickPosterVariant([])).toBeUndefined()
  })
})
