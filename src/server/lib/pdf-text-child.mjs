import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// stdout is exclusively the bounded protocol; do not expose library diagnostics.
for (const method of ['log', 'info', 'warn', 'error', 'debug']) console[method] = () => {}

const MAX_INPUT = 5 * 1024 * 1024
const MAX_PAGE_UNITS = 32_000
const MAX_TOTAL_UNITS = 100_000
const MAX_TEXT_BYTES = 400 * 1024
const MAX_ITEMS = 10_000
class ExtractionFailure extends Error {
  constructor(reason) { super(reason); this.reason = reason }
}
function fail(reason) { throw new ExtractionFailure(reason) }

async function extract() {
  const args = process.argv.slice(2)
  if (args.length !== 2 || args[0] !== '--max-pages' || !/^\d{1,3}$/.test(args[1])) fail('failed')
  const maxPages = Number(args[1])
  if (maxPages < 1 || maxPages > 100) fail('failed')
  let size = 0
  const buffers = []
  for await (const chunk of process.stdin) {
    size += chunk.length
    if (size > MAX_INPUT) fail('invalid')
    buffers.push(chunk)
  }
  if (size === 0) fail('invalid')
  const data = new Uint8Array(Buffer.concat(buffers, size))
  buffers.length = 0

  const require = createRequire(import.meta.url)
  const packageRoot = path.dirname(require.resolve('pdfjs-dist/package.json'))
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(packageRoot, 'legacy/build/pdf.worker.mjs')).href
  // PDF.js requires a trailing slash; its Node factory passes this native path to fs.readFile.
  const resource = name => path.join(packageRoot, name).replaceAll('\\', '/') + '/'
  const loading = getDocument({
    data,
    cMapUrl: resource('cmaps'), cMapPacked: true,
    standardFontDataUrl: resource('standard_fonts'), wasmUrl: resource('wasm'),
    useSystemFonts: false, disableFontFace: true, useWorkerFetch: false, verbosity: 0,
  })
  const parts = []
  let totalUnits = 0
  let totalBytes = 0
  try {
    const document = await loading.promise
    const pageCount = document.numPages
    if (!Number.isInteger(pageCount) || pageCount < 1) fail('invalid')
    if (pageCount > maxPages) fail('too_many_pages')
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      const page = await document.getPage(pageNumber)
      let reader
      let pageUnits = 0
      let itemCount = 0
      const append = text => {
        const byteLength = Buffer.byteLength(text, 'utf8')
        if (pageUnits + text.length > MAX_PAGE_UNITS || totalUnits + text.length > MAX_TOTAL_UNITS ||
          totalBytes + byteLength > MAX_TEXT_BYTES) fail('text_limit')
        pageUnits += text.length
        totalUnits += text.length
        totalBytes += byteLength
        parts.push(text)
      }
      try {
        reader = page.streamTextContent().getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          for (const item of value.items) {
            if (++itemCount > MAX_ITEMS) fail('text_limit')
            if (typeof item.str === 'string') append(item.str + (item.hasEOL ? '\n' : ' '))
          }
        }
        append('\n')
      } finally {
        try { await reader?.cancel(new Error('Text extraction stopped')) } finally { reader?.releaseLock(); page.cleanup() }
      }
    }
    const text = parts.join('')
    if (!text.trim()) fail('empty')
    return { v: 1, ok: true, text, pageCount }
  } finally { await loading.destroy() }
}

let result
try { result = await extract() }
catch (error) {
  const reason = error instanceof ExtractionFailure ? error.reason
    : error?.name === 'PasswordException' ? 'encrypted'
    : ['InvalidPDFException', 'MissingPDFException'].includes(error?.name) ? 'invalid'
    : 'failed'
  result = { v: 1, ok: false, reason }
}
// Do not process.exit before flush; the supervisor still requires actual close.
await new Promise((resolve, reject) => {
  process.stdout.write(JSON.stringify(result), error => error ? reject(new Error('Protocol write failed')) : resolve())
}).catch(() => { process.exitCode = 1 })
