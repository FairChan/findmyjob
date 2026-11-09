#!/usr/bin/env node
/**
 * gen-icons.mjs
 * Generates PWA icons using only Node built-ins (no image library).
 * Brand color: hsl(221, 83%, 53%) ≈ #2463EB
 */

import { deflateSync } from 'zlib'
import { writeFileSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Brand color RGB: hsl(221, 83%, 53%) ≈ rgb(36, 99, 235)
const BRAND_R = 36
const BRAND_G = 99
const BRAND_B = 235

// CRC-32 table (required for PNG chunk checksums)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    t[i] = c
  }
  return t
})()

function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const lenBuf = Buffer.allocUnsafe(4)
  lenBuf.writeUInt32BE(data.length)
  const crcBuf = Buffer.allocUnsafe(4)
  const crcInput = Buffer.concat([typeBytes, data])
  crcBuf.writeUInt32BE(crc32(crcInput))
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf])
}

/**
 * Creates a solid-color RGB PNG.
 * pixelFn(x, y) => [r, g, b]
 */
function makePng(width, height, pixelFn) {
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdrData = Buffer.allocUnsafe(13)
  ihdrData.writeUInt32BE(width, 0)
  ihdrData.writeUInt32BE(height, 4)
  ihdrData[8] = 8  // bit depth
  ihdrData[9] = 2  // RGB
  ihdrData[10] = 0 // deflate
  ihdrData[11] = 0 // adaptive filtering
  ihdrData[12] = 0 // no interlace

  // Build raw scanlines: filter_byte(1) + RGB(3*width) per row
  const rowSize = 1 + 3 * width
  const raw = Buffer.allocUnsafe(height * rowSize)
  for (let y = 0; y < height; y++) {
    raw[y * rowSize] = 0 // None filter
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, y)
      const off = y * rowSize + 1 + x * 3
      raw[off] = r
      raw[off + 1] = g
      raw[off + 2] = b
    }
  }

  const idat = deflateSync(raw)

  return Buffer.concat([
    SIG,
    pngChunk('IHDR', ihdrData),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// Simple 5×7 "F" glyph (1 = white pixel, 0 = background)
const F_GLYPH = [
  [1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0],
  [1, 0, 0, 0, 0],
  [1, 1, 1, 1, 0],
  [1, 0, 0, 0, 0],
  [1, 0, 0, 0, 0],
  [1, 0, 0, 0, 0],
]

function makeIconPixel(x, y, size) {
  // Scale glyph to ~40% of icon, centered
  const scale = Math.max(1, Math.floor(size * 0.4 / 7))
  const glyphW = 5 * scale
  const glyphH = 7 * scale
  const startX = Math.floor((size - glyphW) / 2)
  const startY = Math.floor((size - glyphH) / 2)
  const gx = x - startX
  const gy = y - startY
  if (gx >= 0 && gx < glyphW && gy >= 0 && gy < glyphH) {
    const col = Math.floor(gx / scale)
    const row = Math.floor(gy / scale)
    if (F_GLYPH[row]?.[col] === 1) {
      return [255, 255, 255] // white
    }
  }
  return [BRAND_R, BRAND_G, BRAND_B] // brand blue
}

const outDir = join(__dirname, '..', 'public', 'icons')
mkdirSync(outDir, { recursive: true })

const icons = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'maskable-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
]

for (const { name, size } of icons) {
  const buf = makePng(size, size, (x, y) => makeIconPixel(x, y, size))
  writeFileSync(join(outDir, name), buf)
  console.log(`Generated public/icons/${name} (${size}×${size}, ${buf.length} bytes)`)
}
