import { describe, expect, it } from 'vitest'
import { detectImageMimeType, extensionForMimeType, pickPrimaryVariant } from './media.js'

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

describe('extensionForMimeType', () => {
  it('strips the image/ prefix', () => {
    expect(extensionForMimeType('image/webp')).toBe('webp')
    expect(extensionForMimeType('image/jpeg')).toBe('jpeg')
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
