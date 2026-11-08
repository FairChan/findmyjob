/**
 * Run Lighthouse mobile performance + accessibility audit.
 * Uses Playwright's bundled Chromium so no separate Chrome install is needed.
 *
 * Usage: node scripts/lighthouse.mjs [url]
 *   url defaults to http://localhost:3000
 *
 * Output: JSON report saved to $TEMP/lighthouse-<timestamp>.json
 */
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

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
console.log(`Performance: ${perf}  Accessibility: ${a11y}`)
