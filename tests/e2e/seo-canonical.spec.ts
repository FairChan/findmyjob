/**
 * Paginated list pages are their own canonical (M7-T17): a `?cursor=` page must not point at
 * page 1, and filtered pages stay out of the index.
 */
import { test, expect } from '@playwright/test'

async function head(page: import('@playwright/test').Page, path: string) {
  const res = await page.request.get(path)
  expect(res.status(), path).toBe(200)
  const html = await res.text()
  const canonical = /<link[^>]+rel="canonical"[^>]+href="([^"]*)"/i.exec(html)?.[1] ?? null
  const robots = /<meta[^>]+name="robots"[^>]+content="([^"]*)"/i.exec(html)?.[1] ?? null
  return { canonical, robots }
}

for (const list of ['jobs', 'companies']) {
  test.describe(`/${list} canonical`, () => {
    test('first page points at itself without a query', async ({ page }) => {
      const { canonical } = await head(page, `/zh/${list}`)
      expect(canonical).toMatch(new RegExp(`/zh/${list}$`))
    })

    test('a ?cursor= page points at itself, not at page 1', async ({ page }) => {
      const { canonical } = await head(page, `/zh/${list}?cursor=abc123`)
      expect(canonical?.endsWith(`/zh/${list}?cursor=abc123`)).toBe(true)
    })
  })
}

test('filtered job list stays noindex with no canonical', async ({ page }) => {
  const { canonical, robots } = await head(page, '/zh/jobs?q=engineer')
  expect(robots).toContain('noindex')
  expect(canonical).toBeNull()
})
