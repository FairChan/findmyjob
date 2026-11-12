import type { ChildProcess } from 'node:child_process'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const observed = vi.hoisted(() => ({
  children: [] as { child: ChildProcess; closed: boolean }[], onSpawn: null as (() => void) | null,
}))
vi.mock('node:child_process', async original => {
  const actual = await original<typeof import('node:child_process')>()
  return { ...actual, spawn: (...args: Parameters<typeof actual.spawn>) => {
    const child = actual.spawn(...args)
    const state = { child, closed: false }
    child.once('close', () => { state.closed = true })
    child.once('spawn', () => observed.onSpawn?.())
    observed.children.push(state)
    return child
  } }
})
import { extractResumeText } from '@/server/lib/resume-text'

async function syntheticPdf(pages: string[]) {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  for (const text of pages) {
    const page = document.addPage([600, 800])
    if (text) {
      // Keep stress text inside the page: PDF.js discards off-page glyphs.
      const dense = text.length > 100
      const visibleText = dense ? text.match(/.{1,100}/g)!.join('\n') : text
      page.drawText(visibleText, { x: 30, y: 700, size: dense ? 1 : 10, lineHeight: dense ? 1.5 : 12, font })
    }
  }
  return Buffer.from(await document.save())
}
function extract(bytes: Buffer, maxPages = 20) {
  return extractResumeText(bytes, { maxPages, signal: new AbortController().signal })
}
beforeEach(() => { observed.children.length = 0; observed.onSpawn = null })

// Requires the pinned pdfjs-dist package. No SDK, network, real resume, or DB is
// used by these tests; repository globalSetup may still acquire the DB lock.
describe('T01 actual PDF extraction process', () => {
  it('kills an actual child on cancellation, awaits close, and permits recovery', async () => {
    const controller = new AbortController()
    observed.onSpawn = () => controller.abort()
    const result = await extractResumeText(await syntheticPdf(['Synthetic cancellation']), {
      maxPages: 20, signal: controller.signal,
    })
    observed.onSpawn = null
    expect(result).toEqual({ ok: false, reason: 'aborted' })
    expect(observed.children[0].closed).toBe(true)
    expect(await extract(await syntheticPdf(['Synthetic recovery']))).toMatchObject({ ok: true, pageCount: 1 })
    expect(observed.children.every(item => item.closed)).toBe(true)
  })

  it('extracts two synthetic pages and returns only after native child close', async () => {
    const result = await extract(await syntheticPdf(['Synthetic engineering experience', 'Synthetic education']))
    expect(result).toMatchObject({ ok: true, pageCount: 2 })
    expect(JSON.stringify(result)).toContain('Synthetic engineering experience')
    expect(JSON.stringify(result)).toContain('Synthetic education')
    expect(observed.children).toHaveLength(1)
    expect(observed.children[0].closed).toBe(true)
    expect(observed.children[0].child.exitCode).toBe(0)
  })

  it('rejects excessive pages without processing them into a successful result', async () => {
    expect(await extract(await syntheticPdf(['Synthetic A', 'Synthetic B']), 1))
      .toEqual({ ok: false, reason: 'too_many_pages' })
    expect(observed.children[0].closed).toBe(true)
  })

  it('returns empty for a synthetic page with no extractable text', async () => {
    expect(await extract(await syntheticPdf(['']))).toEqual({ ok: false, reason: 'empty' })
    expect(observed.children[0].closed).toBe(true)
  })

  it('sanitizes a malformed PDF and allows the next document to succeed', async () => {
    expect(await extract(Buffer.from('%PDF-1.7\nPRIVATE_INVALID_PDF_SENTINEL')))
      .toEqual({ ok: false, reason: 'invalid' })
    expect(await extract(await syntheticPdf(['Synthetic recovery']))).toMatchObject({ ok: true, pageCount: 1 })
    expect(observed.children.every(item => item.closed)).toBe(true)
  })

  it('accepts the exact input-byte limit while rejecting one byte over before spawn', async () => {
    const pdf = await syntheticPdf(['Synthetic boundary'])
    const exact = Buffer.concat([pdf, Buffer.alloc(5 * 1024 * 1024 - pdf.length, 32)])
    expect(await extract(exact)).toMatchObject({ ok: true, pageCount: 1 })
    expect(await extract(Buffer.concat([exact, Buffer.from(' ')]))).toEqual({ ok: false, reason: 'input_limit' })
    expect(observed.children).toHaveLength(1)
    expect(observed.children[0].closed).toBe(true)
  })

  it.each([
    ['one page', ['x'.repeat(32_001)]],
    ['whole document', Array.from({ length: 4 }, () => 'x'.repeat(25_001))],
  ])('rejects excessive text in %s without truncating it', async (_label, pages) => {
    expect(await extract(await syntheticPdf(pages as string[]))).toEqual({ ok: false, reason: 'text_limit' })
    expect(observed.children[0].closed).toBe(true)
  })
})
