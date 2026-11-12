import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface LinkProps {
  href: string
  prefetch?: boolean
  children?: ReactNode
}

const mocks = vi.hoisted(() => ({
  link: vi.fn(),
  search: vi.fn(),
}))

vi.mock('next/headers', () => ({ headers: async () => new Headers() }))
vi.mock('next/navigation', () => ({
  redirect: () => { throw new Error('Unexpected redirect') },
}))
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))
vi.mock('next/link', () => ({ default: mocks.link }))
vi.mock('@/server/authz', () => ({
  requireCompanyMember: async () => ({ userId: 'employer-user', companyId: 'company-id' }),
}))
vi.mock('@/server/db', () => ({
  db: {
    company: { findUnique: async () => ({ verificationStatus: 'VERIFIED' }) },
    school: { findMany: async () => [] },
  },
}))
vi.mock('@/server/services/talent-search', () => ({ searchTalents: mocks.search }))
vi.mock('@/components/talent/TalentFilterPanel', () => ({ TalentFilterPanel: () => null }))
vi.mock('@/components/talent/SaveToFolderButton', () => ({ SaveToFolderButton: () => null }))

import TalentSearchPage from '@/app/[locale]/e/talent/page'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.link.mockImplementation(({ href, children }: LinkProps) =>
    createElement('a', { href }, children),
  )
  mocks.search.mockResolvedValue({
    students: [{
      id: 'prefetch-student', name: 'Fictional S.', unlocked: false,
      school: null, major: null, degreeLevel: null, graduationYear: null,
      cgpa: null, skills: [], headline: null, completeness: 80,
      workAuth: null, lastActiveAt: null,
    }],
    total: 1, page: 1, pageSize: 20, maxPage: 1,
  })
})

describe('M4-T17: talent-card links explicitly disable Next prefetch', () => {
  it.each(['zh', 'en'] as const)('%s name and detail links both have prefetch=false', async (locale) => {
    const html = renderToStaticMarkup(await TalentSearchPage({
      params: Promise.resolve({ locale }), searchParams: Promise.resolve({}),
    }))
    const target = '/' + locale + '/e/talent/prefetch-student'
    const detailLinks = mocks.link.mock.calls
      .map(([props]) => props as LinkProps)
      .filter((props) => props.href === target)

    // Non-vacuous: render the real search page and both real card entry points.
    // Removing either prefetch prop changes the corresponding value to undefined.
    expect(html).toContain('Fictional S.')
    expect(detailLinks).toHaveLength(2)
    expect(detailLinks.map((props) => props.prefetch)).toEqual([false, false])
  })
})
