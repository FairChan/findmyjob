import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('HR badges support keyboard navigation, flipping and Escape', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/zh')
  const rail = page.getByTestId('recruiter-rail')
  await expect(rail).toBeVisible()
  const badges = rail.locator('[data-badge]')
  await expect(badges).toHaveCount(6)
  const portraits = rail.locator('[data-face="front"] img')
  await expect(portraits).toHaveCount(6)
  await expect
    .poll(() =>
      portraits.evaluateAll((images) =>
        images.every((image) => (image as HTMLImageElement).naturalWidth > 0),
      ),
    )
    .toBe(true)
  await badges.first().focus()
  await page.keyboard.press('Enter')
  await expect(badges.first()).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(badges.first()).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('ArrowRight')
  await expect(badges.nth(1)).toBeFocused()
  const a11y = await new AxeBuilder({ page }).include('[data-testid="recruiter-rail"]').analyze()
  expect(a11y.violations).toEqual([])
})

test('375px carousel fits the screen and selects another HR', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/zh')
  const rail = page.getByTestId('recruiter-rail')
  const picker = rail.getByRole('button', { name: '查看 Aisha' })
  await picker.click()
  await expect(picker).toHaveAttribute('aria-current', 'true')
  const selected = rail.getByRole('button', { name: 'Aisha, 人才招聘顾问' })
  await selected.click()
  await expect(selected).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  const a11y = await new AxeBuilder({ page }).include('[data-testid="recruiter-rail"]').analyze()
  expect(a11y.violations).toEqual([])
})

test('English copy and recruitment links stay in the current locale', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/en')
  const rail = page.getByTestId('recruiter-rail')
  await expect(
    rail.getByRole('heading', { name: 'Meet the people behind your next opportunity.' }),
  ).toBeVisible()
  await rail.locator('[data-badge]').first().click()
  const jobs = rail.getByRole('link', { name: 'Explore roles' })
  await expect(jobs).toBeVisible()
  await expect(jobs).toHaveAttribute('href', '/en/jobs')
  await jobs.click()
  await expect(page).toHaveURL(/\/en\/jobs$/)
})

test('badges ignore dragging and still flip on click', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/zh')
  const rail = page.getByTestId('recruiter-rail')
  await rail.scrollIntoViewIfNeeded()
  const badge = rail.locator('[data-badge]').first()
  await badge.focus()
  await page.keyboard.press('Escape')
  const box = await badge.boundingBox()
  expect(box).not.toBeNull()
  const x = box!.x + box!.width / 2
  const y = box!.y + box!.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + 55, { steps: 12 })
  const cord = rail.locator('[data-lanyard="0"] [data-hang]')
  // Pulling down must not stretch the cord: the rail answers to hover and click only.
  await page.waitForTimeout(400)
  expect(
    await cord.evaluate((node) => Math.abs(new DOMMatrix(getComputedStyle(node).transform).m42)),
  ).toBeLessThan(6)
  await page.mouse.up()
  // Nor can a badge be dragged sideways along the rail.
  const before = (await badge.boundingBox())!.x
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 120, y, { steps: 12 })
  await page.waitForTimeout(400)
  await page.mouse.up()
  await page.waitForTimeout(900)
  expect(Math.abs((await badge.boundingBox())!.x - before)).toBeLessThan(12)
  await badge.click()
  await expect(badge).toHaveAttribute('aria-pressed', 'true')
  expect(errors).toEqual([])
})
