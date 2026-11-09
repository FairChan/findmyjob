/**
 * Run Lighthouse mobile performance + accessibility audit with threshold checks.
 * Uses Playwright's bundled Chromium so no separate Chrome install is needed.
 *
 * Usage: node scripts/lighthouse.mjs [url]
 *   url defaults to http://localhost:3000
 *
 * Thresholds: performance ≥85, accessibility ≥90, LCP ≤2500ms, CLS ≤0.1, TBT ≤300ms
 * Output: JSON report saved to $TEMP/lighthouse-<timestamp>.json
 * Exit code: 0 = all thresholds met, 1 = one or more thresholds missed
 */
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const THRESHOLDS = {
  performance: 85,
  accessibility: 90,
  lcpMs: 2500,
  cls: 0.1,
  tbtMs: 300,
}

const url = process.argv[2] ?? 'http://localhost:3000'
const outFile = join(tmpdir(), `lighthouse-${Date.now()}.json`)

// Lighthouse needs a Chrome it can reach over the DevTools protocol, so keep Playwright's bundled
// Chromium open with a remote-debugging port for the duration of the run.
const port = Number(process.env.LIGHTHOUSE_CDP_PORT ?? 9333)
const browser = await chromium.launch({ headless: true, args: [`--remote-debugging-port=${port}`] })

const { default: lighthouse } = await import('lighthouse')

let result
try {
  result = await lighthouse(url, {
    port,
    logLevel: 'error',
    output: 'json',
    formFactor: 'mobile',
    screenEmulation: { mobile: true, width: 375, height: 812, deviceScaleFactor: 2, disabled: false },
    onlyCategories: ['performance', 'accessibility'],
  })
} finally {
  await browser.close()
}

if (!result?.report) {
  console.error('Lighthouse returned no report')
  process.exit(1)
}

writeFileSync(outFile, typeof result.report === 'string' ? result.report : JSON.stringify(result.report))
console.log(`Lighthouse report saved to: ${outFile}`)

const { lhr } = result
const perf = Math.round((lhr.categories.performance?.score ?? 0) * 100)
const a11y = Math.round((lhr.categories.accessibility?.score ?? 0) * 100)

// Extract web vitals from audits
const lcpAudit = lhr.audits['largest-contentful-paint']
const clsAudit = lhr.audits['cumulative-layout-shift']
const tbtAudit = lhr.audits['total-blocking-time']

const lcpMs = Math.round((lcpAudit?.numericValue ?? 0))
const cls = Number((clsAudit?.numericValue ?? 0).toFixed(3))
const tbtMs = Math.round((tbtAudit?.numericValue ?? 0))

console.log('\nResults:')
console.log(`  Performance:   ${perf}  (threshold: ≥${THRESHOLDS.performance})  ${perf >= THRESHOLDS.performance ? '✓' : '✗'}`)
console.log(`  Accessibility: ${a11y}  (threshold: ≥${THRESHOLDS.accessibility})  ${a11y >= THRESHOLDS.accessibility ? '✓' : '✗'}`)
console.log(`  LCP:           ${lcpMs}ms  (threshold: ≤${THRESHOLDS.lcpMs}ms)  ${lcpMs <= THRESHOLDS.lcpMs ? '✓' : '✗'}`)
console.log(`  CLS:           ${cls}  (threshold: ≤${THRESHOLDS.cls})  ${cls <= THRESHOLDS.cls ? '✓' : '✗'}`)
console.log(`  TBT:           ${tbtMs}ms  (threshold: ≤${THRESHOLDS.tbtMs}ms)  ${tbtMs <= THRESHOLDS.tbtMs ? '✓' : '✗'}`)

const passed =
  perf >= THRESHOLDS.performance &&
  a11y >= THRESHOLDS.accessibility &&
  lcpMs <= THRESHOLDS.lcpMs &&
  cls <= THRESHOLDS.cls &&
  tbtMs <= THRESHOLDS.tbtMs

if (!passed) {
  console.error('\nOne or more Lighthouse thresholds not met.')
  process.exit(1)
}

console.log('\nAll Lighthouse thresholds met.')
