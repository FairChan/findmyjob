// @vitest-environment jsdom
/** Render the real page/body with service boundaries mocked. The client dialog
 * behavior is covered separately by unlock-cutover-guidance.test.ts. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { createTranslator, type AbstractIntlMessages } from 'next-intl'
import TalentDetailPage from '@/app/[locale]/e/talent/[id]/page'
import type { UnlockButton } from '@/components/talent/UnlockButton'
import type { TalentDetail } from '@/server/serializers/talent-card'
import { setupUi, mount, messages, usage } from '../helpers/entitlements-ui-t04'

type UnlockProps = ComponentProps<typeof UnlockButton>

const mocks = vi.hoisted(() => ({
  member: vi.fn(),
  setting: vi.fn(),
  unlockSettings: vi.fn(),
  usage: vi.fn(),
  company: vi.fn(),
  jobs: vi.fn(),
  talent: vi.fn(),
  unlockButton: vi.fn<(props: UnlockProps) => null>(),
  locale: 'en' as 'zh' | 'en',
  billingValue: true as unknown,
}))

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn(), notFound: vi.fn() }))
vi.mock('@/server/authz', () => ({ requireCompanyMember: mocks.member }))
vi.mock('@/server/db', () => ({
  db: { company: { findUnique: mocks.company }, job: { findMany: mocks.jobs } },
}))
vi.mock('@/server/services/settings', () => ({ getSetting: mocks.setting }))
vi.mock('@/server/services/unlock', () => ({ getValidatedUnlockSettings: mocks.unlockSettings }))
vi.mock('@/server/services/subscription-entitlements', () => ({ getCompanyEntitlementUsage: mocks.usage }))
vi.mock('@/server/services/talent-view', () => ({ viewTalentProfile: mocks.talent }))
vi.mock('@/components/talent/UnlockButton', () => ({ UnlockButton: mocks.unlockButton }))
vi.mock('@/components/talent/SaveToFolderButton', () => ({ SaveToFolderButton: () => null }))
vi.mock('@/components/invitations/InviteButton', () => ({ InviteButton: () => null }))
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => createTranslator({
    locale: mocks.locale,
    messages: messages(mocks.locale) as AbstractIntlMessages,
    namespace,
  }),
}))

setupUi()

const ctx = { userId: 'synthetic-user', companyId: 'synthetic-company', role: 'OWNER' as const }
const detail: TalentDetail = {
  id: 'synthetic-student',
  name: 'Synthetic Talent',
  unlocked: false,
  school: null,
  major: null,
  degreeLevel: null,
  graduationYear: null,
  cgpa: null,
  skills: [],
  headline: null,
  completeness: 0,
  workAuth: null,
  lastActiveAt: null,
  summary: null,
  educations: [],
  experiences: [],
  resumeCount: 0,
  resumePreview: null,
  resumeIds: [],
  contact: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.billingValue = true
  mocks.member.mockReset().mockResolvedValue(ctx)
  mocks.setting.mockReset().mockImplementation(async (key: string, fallback: unknown) =>
    key === 'billing.enabled' ? mocks.billingValue : fallback)
  mocks.unlockSettings.mockReset().mockResolvedValue({ costCredits: 2 })
  mocks.usage.mockReset().mockResolvedValue(usage())
  mocks.company.mockReset().mockResolvedValue({ verificationStatus: 'VERIFIED' })
  mocks.jobs.mockReset().mockResolvedValue([])
  mocks.talent.mockReset().mockResolvedValue(detail)
  mocks.unlockButton.mockReset().mockReturnValue(null)
})

async function renderUnlockProps(): Promise<UnlockProps> {
  await mount(mocks.locale, await TalentDetailPage({
    params: Promise.resolve({ locale: mocks.locale, id: detail.id }),
  }))
  expect(mocks.member).toHaveBeenCalledExactlyOnceWith('RECRUITER', expect.any(Headers))
  expect(mocks.setting).toHaveBeenCalledWith('billing.enabled', false, { fresh: true })
  expect(mocks.unlockButton).toHaveBeenCalledTimes(1)
  const props = mocks.unlockButton.mock.calls[0]![0]
  expect(props.studentId).toBe(detail.id)
  return props
}

for (const locale of ['zh', 'en'] as const) {
  describe(locale + ' unlock cutover page guidance', () => {
    beforeEach(() => { mocks.locale = locale })

    it('gives the current owner a fixed local billing link when billing is literal true', async () => {
      // Unlock guidance follows membership, independently of invitation entitlements.
      mocks.usage.mockResolvedValueOnce(usage({ canPurchase: false }))
      const props = await renderUnlockProps()

      expect(props.labels.errorInsufficient).toBe(messages(locale).talentDetail.unlockErrorInsufficient)
      expect(props.insufficientCreditsAdvice).toEqual({
        text: messages(locale).talentDetail.unlockPurchaseCredits,
        href: `/${locale}/e/billing`,
      })
    })

    it('asks the current recruiter to contact the owner without a purchase link', async () => {
      mocks.member.mockResolvedValueOnce({ ...ctx, role: 'RECRUITER' })
      mocks.usage.mockResolvedValueOnce(usage({ canPurchase: true }))
      const props = await renderUnlockProps()

      expect(props.labels.errorInsufficient).toBe(messages(locale).talentDetail.unlockErrorInsufficient)
      expect(props.insufficientCreditsAdvice).toEqual({
        text: messages(locale).talentDetail.unlockAskOwnerToPurchase,
      })
      expect(props.insufficientCreditsAdvice).not.toHaveProperty('href')
    })

    for (const role of ['OWNER', 'RECRUITER'] as const) {
      it.each([false, 'false', 0, null])('keeps pilot guidance for ' + role + ' when billing is %j', async (billingValue) => {
        mocks.billingValue = billingValue
        mocks.member.mockResolvedValueOnce({ ...ctx, role })
        const props = await renderUnlockProps()

        expect(props.labels.errorInsufficient).toBe(messages(locale).talentDetail.unlockErrorInsufficientPilot)
        expect(props.insufficientCreditsAdvice).toBeUndefined()
      })
    }
  })
}
