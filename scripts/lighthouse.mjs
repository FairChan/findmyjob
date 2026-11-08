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
import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:3000'
const outFile = join(tmpdir(), `lighthouse-${Date.now()}.json`)

// Resolve Playwright's bundled Chromium executable path
const browser = await chromium.launch({ headless: true })
const executablePath = browser.executablePath ? browser.executablePath() : chromium.executablePath()
await browser.close()

process.env.CHROME_PATH = executablePath

// Dynamic import after setting env var so Lighthouse picks it up
const { default: lighthouse } = await import('lighthouse')

const result = await lighthouse(url, {
  port: undefined,
  logLevel: 'error',
  output: 'json',
  formFactor: 'mobile',
  screenEmulation: {
    mobile: true,
    width: 375,
    height: 812,
    deviceScaleFactor: 2,
    disabled: false,
  },
  onlyCategories: ['performance', 'accessibility'],
  chromePath: executablePath,
})

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
