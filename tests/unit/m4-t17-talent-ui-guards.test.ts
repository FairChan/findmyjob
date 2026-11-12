import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createTranslator, type AbstractIntlMessages } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import zhMessages from '../../messages/zh.json'
import enMessages from '../../messages/en.json'
import type { UnlockButtonLabels } from '@/components/talent/UnlockButton'

const mocks = vi.hoisted(() => ({
  locale: 'zh' as 'zh' | 'en',
  unlockEnabled: true,
  billingEnabled: false,
  rawCost: -9,
  validatedSettings: vi.fn(),
  getSetting: vi.fn(),
  viewTalent: vi.fn(),
  unlockButton: vi.fn(),
}))

vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => createTranslator({
    locale: mocks.locale,
    messages: (mocks.locale === 'zh' ? zhMessages : enMessages) as AbstractIntlMessages,
    namespace,
  }),
}))
vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('Unexpected notFound') },
  redirect: () => { throw new Error('Unexpected redirect') },
}))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children?: ReactNode }) =>
    createElement('a', { href }, children),
}))
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children?: ReactNode }) =>
    createElement('a', { href }, children),
  // The student navigation marks the current page.
  usePathname: () => '/s',
}))
vi.mock('@/server/authz', () => ({
  requireCompanyMember: async () => ({ userId: 'employer-user', companyId: 'company-id' }),
}))
vi.mock('@/server/db', () => ({
  db: {
    company: { findUnique: async () => ({ verificationStatus: 'VERIFIED' }) },
    job: { findMany: async () => [] },
    notification: { count: async () => 0 },
    studentProfile: { findUnique: async () => ({ id: 'student-id' }) },
    invitation: { count: async () => 0 },
  },
}))
vi.mock('@/server/services/settings', () => ({ getSetting: mocks.getSetting }))
vi.mock('@/server/services/unlock', () => ({
  getValidatedUnlockSettings: mocks.validatedSettings,
}))
vi.mock('@/server/services/talent-view', () => ({ viewTalentProfile: mocks.viewTalent }))
vi.mock('@/server/services/subscription-entitlements', () => ({
  getCompanyEntitlementUsage: async () => ({
    source: 'PILOT', effectiveUntil: null, canPurchase: false,
    jobs: { used: 0, limit: null }, seats: { used: 1, reserved: 0, limit: 3 },
    invitations: { used: 0, limit: 10 },
  }),
}))
vi.mock('@/components/talent/SaveToFolderButton', () => ({ SaveToFolderButton: () => null }))
vi.mock('@/components/invitations/InviteButton', () => ({ InviteButton: () => null }))
vi.mock('@/components/talent/UnlockButton', () => ({ UnlockButton: mocks.unlockButton }))

import TalentDetailPage from '@/app/[locale]/e/talent/[id]/page'
import StudentNav from '@/components/layout/StudentNav'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.locale = 'zh'
  mocks.unlockEnabled = true
  mocks.billingEnabled = false
  mocks.rawCost = -9
  mocks.validatedSettings.mockResolvedValue({ costCredits: 7, dailyLimit: 50 })
  mocks.getSetting.mockImplementation(async (key: string, fallback: unknown) => {
    if (key === 'unlock.enabled') return mocks.unlockEnabled
    if (key === 'billing.enabled') return mocks.billingEnabled
    if (key === 'unlock.costCredits') return mocks.rawCost
    return fallback
  })
  mocks.viewTalent.mockResolvedValue({
    id: 'student-id',
    name: 'Fictional S.',
    unlocked: false,
    school: null,
    major: null,
    degreeLevel: null,
    graduationYear: null,
    cgpa: null,
    skills: [],
    headline: null,
    completeness: 80,
    workAuth: null,
    lastActiveAt: null,
    summary: null,
    educations: [],
    experiences: [],
    resumeCount: 0,
    resumePreview: null,
    resumeIds: [],
    contact: null,
  })
  // This suite tests the server-page/client boundary. The real interactive dialog
  // belongs in a later component/E2E batch; no unlock action is invoked here.
  mocks.unlockButton.mockImplementation(({ labels }: { labels: UnlockButtonLabels }) =>
    createElement('button', { 'data-testid': 'unlock-button' }, labels.button),
  )
})

async function renderTalentPage() {
  const page = await TalentDetailPage({
    params: Promise.resolve({ locale: mocks.locale, id: 'student-id' }),
  })
  return renderToStaticMarkup(page)
}

function suppliedLabels(): UnlockButtonLabels {
  expect(mocks.unlockButton).toHaveBeenCalled()
  return mocks.unlockButton.mock.calls[0][0].labels as UnlockButtonLabels
}

describe('M4-T17: talent detail unlock UI guards', () => {
  it('does not render an unlock control when unlock.enabled is false', async () => {
    mocks.unlockEnabled = false

    const html = await renderTalentPage()

    expect(html).not.toContain('data-testid="unlock-button"')
    expect(mocks.unlockButton).not.toHaveBeenCalled()
  })

  it.each(['zh', 'en'] as const)('%s button and confirmation use the shared validated cost', async (locale) => {
    mocks.locale = locale

    const html = await renderTalentPage()
    const labels = suppliedLabels()

    expect(mocks.validatedSettings).toHaveBeenCalledOnce()
    expect(labels.button).toContain('7')
    expect(labels.confirmCost).toContain('7')
    expect(labels.button).not.toContain('-9')
    expect(labels.confirmCost).not.toContain('{cost}')
    expect(html).toContain(labels.button)
  })

  it.each([
    ['zh', /下月\s*1\s*日/],
    ['en', /(?:1st|first day) of (?:the )?next month/i],
  ] as const)('%s pilot insufficient-credit message explains the next grant', async (locale, expected) => {
    mocks.locale = locale

    await renderTalentPage()

    expect(suppliedLabels().errorInsufficient).toMatch(expected)
  })

  it.each(['zh', 'en'] as const)('%s paid mode does not promise pilot credits', async (locale) => {
    mocks.locale = locale
    mocks.billingEnabled = true

    await renderTalentPage()

    expect(suppliedLabels().errorInsufficient).not.toMatch(/下月|next month/i)
  })
})

describe('M4-T17: student navigation has a purpose-specific accessible name', () => {
  it.each([
    ['zh', '学生导航'],
    ['en', 'Student navigation'],
  ] as const)('%s navigation is not labelled as notifications', async (locale, label) => {
    mocks.locale = locale

    const html = renderToStaticMarkup(await StudentNav({ userId: 'student-user', locale }))

    expect(html).toContain('aria-label="' + label + '"')
    expect(html).toContain('href="/s/notifications"')
  })
})
