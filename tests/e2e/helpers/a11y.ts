import { expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/** Assert that the current page has zero serious or critical accessibility violations. */
export async function checkA11y(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze()
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical'
  )
  expect(
    blocking,
    `Found ${blocking.length} serious/critical a11y violations:\n` +
      blocking.map((v) => `  [${v.impact}] ${v.id}: ${v.description}`).join('\n')
  ).toHaveLength(0)
}
