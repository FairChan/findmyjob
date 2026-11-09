import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PDFArray, PDFBool, PDFDict, PDFDocument, PDFHexString,
  PDFName, PDFNull, PDFNumber, PDFString, type PDFObject,
} from 'pdf-lib'

const mockGetSetting = vi.hoisted(() => vi.fn())
vi.mock('@/server/services/settings', () => ({ getSetting: mockGetSetting }))

import { sanitizePdf } from '@/server/lib/pdf-sanitize'

beforeEach(() => {
  mockGetSetting.mockResolvedValue(50 * 1024 * 1024)
})

type LinkForm = 'Dest' | 'GoTo'
type ValueFactory = (doc: PDFDocument) => PDFObject

const invalidDestinationValues: [string, ValueFactory][] = [
  ['direct dictionary', doc => doc.context.obj({ S: 'JavaScript', JS: PDFString.of('blocked') })],
  ['direct array', doc => doc.context.obj([1, 2])],
  ['literal string', () => PDFString.of('blocked')],
  ['hex string', () => PDFHexString.fromText('blocked')],
  ['boolean', () => PDFBool.True],
]

const invalidRectangleValues: [string, ValueFactory][] = [
  ...invalidDestinationValues,
  ['name', () => PDFName.of('Fit')],
  ['null', () => PDFNull],
]

async function makeLinkPdf(
  form: LinkForm,
  invalid?: { field: 'destination' | 'rectangle'; value: ValueFactory },
): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  const target = doc.addPage([612, 792])
  const destination = doc.context.obj([target.ref, PDFName.of('XYZ'), PDFNull, 100, PDFNull])
  const rectangle = doc.context.obj([10, 10, 100, 30])
  if (invalid?.field === 'destination') destination.set(2, invalid.value(doc))
  if (invalid?.field === 'rectangle') rectangle.set(0, invalid.value(doc))
  const annotation = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: rectangle,
  })
  if (form === 'Dest') {
    annotation.set(PDFName.of('Dest'), destination)
  } else {
    annotation.set(PDFName.of('A'), doc.context.obj({ S: 'GoTo', D: destination }))
  }
  page.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(annotation)]))
  return Buffer.from(await doc.save({ useObjectStreams: false }))
}

function annotations(doc: PDFDocument): PDFDict[] {
  const entry = doc.getPage(0).node.get(PDFName.of('Annots'))
  if (!entry) return []
  const array = doc.context.lookup(entry, PDFArray)
  return array.asArray().map(item => doc.context.lookup(item, PDFDict))
}

async function sanitizeFixture(input: Buffer): Promise<PDFDocument> {
  // A surviving input annotation prevents a vacuous "nothing to remove" pass.
  expect(annotations(await PDFDocument.load(input))).toHaveLength(1)
  const result = await sanitizePdf(input)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('Sanitization failed: ' + result.reason)
  const output = await PDFDocument.load(result.pdf)
  expect(output.getPageCount()).toBe(2)
  return output
}

describe.each(['Dest', 'GoTo'] as const)('%s destination whitelist (M4-T17)', form => {
  it.each(invalidDestinationValues)('removes a Link containing a %s destination value', async (_name, value) => {
    const output = await sanitizeFixture(await makeLinkPdf(form, { field: 'destination', value }))

    expect(annotations(output)).toHaveLength(0)
  })

  it('preserves an internal XYZ destination with name, number and null values', async () => {
    const output = await sanitizeFixture(await makeLinkPdf(form))
    const links = annotations(output)

    expect(links).toHaveLength(1)
    const destination = output.context.lookup(links[0].get(PDFName.of('Dest')), PDFArray)
    expect(destination.size()).toBe(5)
    expect(destination.get(0).toString()).toBe(output.getPage(1).ref.toString())
    expect(destination.get(1)).toBe(PDFName.of('XYZ'))
    expect(destination.get(2)).toBe(PDFNull)
    expect((destination.get(3) as PDFNumber).asNumber()).toBe(100)
    expect(destination.get(4)).toBe(PDFNull)
    const rectangle = output.context.lookup(links[0].get(PDFName.of('Rect')), PDFArray)
    expect(rectangle.asArray().map(value => (value as PDFNumber).asNumber()))
      .toEqual([10, 10, 100, 30])
    expect(links[0].has(PDFName.of('A'))).toBe(false)
  })
})

describe('Link rectangle whitelist (M4-T17)', () => {
  it.each(invalidRectangleValues)('removes a Link containing a %s rectangle coordinate', async (_name, value) => {
    const output = await sanitizeFixture(await makeLinkPdf('Dest', { field: 'rectangle', value }))

    expect(annotations(output)).toHaveLength(0)
  })
})
