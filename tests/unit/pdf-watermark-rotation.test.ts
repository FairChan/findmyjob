import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PDFArray, PDFDocument, PDFName, PDFRawStream,
  StandardFonts, decodePDFRawStream, degrees, type PDFPage,
} from 'pdf-lib'

const mockGetSetting = vi.hoisted(() => vi.fn())
vi.mock('@/server/services/settings', () => ({ getSetting: mockGetSetting }))

import { watermarkPdf } from '@/server/lib/pdf-watermark'

beforeEach(() => {
  mockGetSetting.mockResolvedValue(50 * 1024 * 1024)
})

type Matrix = [number, number, number, number, number, number]
type Point = { x: number; y: number }
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
const TEXT = 'For Example Ltd only - 2026-11-09 - student-01'

function compose(outer: Matrix, inner: Matrix): Matrix {
  const [a, b, c, d, e, f] = outer
  const [g, h, i, j, k, l] = inner
  return [
    a * g + c * h, b * g + d * h,
    a * i + c * j, b * i + d * j,
    a * k + c * l + e, b * k + d * l + f,
  ]
}

function point(matrix: Matrix, x: number, y: number): Point {
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  }
}

function content(doc: PDFDocument, page: PDFPage): string {
  const value = page.node.get(PDFName.of('Contents'))
  if (!value) throw new Error('Watermarked page has no content')
  const object = doc.context.lookup(value)
  const items = object instanceof PDFArray ? object.asArray() : [object]
  return items.map(item => {
    const stream = doc.context.lookup(item)
    if (!(stream instanceof PDFRawStream)) throw new Error('Expected a PDF content stream')
    return Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')
  }).join('\n')
}

// These fixtures contain no original text. Interpret the generated text and
// graphics matrices so either Tm rotation or a surrounding cm transform is valid.
function watermarkPlacement(decoded: string): { matrix: Matrix; size: number } {
  let graphics: Matrix = IDENTITY
  let text: Matrix = IDENTITY
  let size = 0
  const stack: Matrix[] = []
  const placements: { matrix: Matrix; size: number }[] = []
  for (const line of decoded.split(/\r?\n/)) {
    const tokens = line.trim().split(/\s+/)
    const operator = tokens.pop()
    if (operator === 'q') stack.push(graphics)
    if (operator === 'Q') {
      const restored = stack.pop()
      if (!restored) throw new Error('Unbalanced graphics state')
      graphics = restored
    }
    if (operator === 'cm' || operator === 'Tm') {
      const values = tokens.map(Number)
      if (values.length !== 6 || !values.every(Number.isFinite)) {
        throw new Error('Invalid transformation matrix')
      }
      const matrix = values as Matrix
      if (operator === 'cm') graphics = compose(graphics, matrix)
      else text = matrix
    }
    if (operator === 'Tf') size = Number(tokens[1])
    if (operator === 'Tj') placements.push({ matrix: compose(graphics, text), size })
  }
  expect(placements).toHaveLength(1)
  expect(placements[0].size).toBeGreaterThan(0)
  return placements[0]
}

// PDF /Rotate is clockwise. Express the displayed page with its origin at
// bottom-left and positive y pointing up; this is independent of layout code.
function displayed(point: Point, width: number, height: number, rotation: number): Point {
  switch (rotation) {
    case 0: return point
    case 90: return { x: point.y, y: width - point.x }
    case 180: return { x: width - point.x, y: height - point.y }
    case 270: return { x: height - point.y, y: point.x }
    default: throw new Error('Unexpected page rotation')
  }
}

describe('watermark visual placement on rotated pages (M4-T17)', () => {
  it.each([0, 90, 180, 270])('keeps an upright rising diagonal and centered text with /Rotate %i', async rotation => {
    const input = await PDFDocument.create()
    input.addPage([612, 792]).setRotation(degrees(rotation))
    input.addPage([792, 612]).setRotation(degrees(rotation))

    const result = await watermarkPdf(Buffer.from(await input.save()), { text: TEXT })

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Watermark failed: ' + result.reason)
    const output = await PDFDocument.load(result.pdf)
    expect(output.getPageCount()).toBe(2)
    const metricDoc = await PDFDocument.create()
    const font = await metricDoc.embedFont(StandardFonts.Helvetica)
    const encodedText = '<' + Buffer.from(TEXT, 'latin1').toString('hex').toUpperCase() + '>'

    for (const page of output.getPages()) {
      expect(page.getRotation().angle).toBe(rotation)
      const { width, height } = page.getSize()
      const decoded = content(output, page)
      expect(decoded.toUpperCase()).toContain(encodedText)
      const { matrix, size } = watermarkPlacement(decoded)
      const baselineStart = displayed(point(matrix, 0, 0), width, height, rotation)
      const baselineEnd = displayed(point(matrix, 1, 0), width, height, rotation)
      const dx = baselineEnd.x - baselineStart.x
      const dy = baselineEnd.y - baselineStart.y

      // Direction matters: an upside-down 225-degree diagonal must not pass.
      expect(dx).toBeGreaterThan(0)
      expect(dy).toBeGreaterThan(0)
      expect(Math.atan2(dy, dx) * 180 / Math.PI).toBeCloseTo(45, 4)

      const textWidth = font.widthOfTextAtSize(TEXT, size)
      const viewWidth = rotation % 180 === 0 ? width : height
      const viewHeight = rotation % 180 === 0 ? height : width
      const center = displayed(point(matrix, textWidth / 2, size / 2), width, height, rotation)
      // Allow font ascent/descent differences within half an em.
      expect(Math.abs(center.x - viewWidth / 2)).toBeLessThanOrEqual(size / 2)
      expect(Math.abs(center.y - viewHeight / 2)).toBeLessThanOrEqual(size / 2)
      for (const [x, y] of [[0, 0], [textWidth, 0], [0, size], [textWidth, size]]) {
        const corner = displayed(point(matrix, x, y), width, height, rotation)
        expect(corner.x).toBeGreaterThanOrEqual(0)
        expect(corner.x).toBeLessThanOrEqual(viewWidth)
        expect(corner.y).toBeGreaterThanOrEqual(0)
        expect(corner.y).toBeLessThanOrEqual(viewHeight)
      }
    }
  })
})
