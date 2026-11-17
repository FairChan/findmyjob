import { fireEvent, screen, waitFor } from '@testing-library/react-native'

import Home from '../app/(tabs)/home'
import JobsTab from '../app/(tabs)/jobs'
import JobScreen from '../app/jobs/[id]'
import { jobsPath } from '@/features/jobs/api'
import { looksLikeImeComposing } from '@/features/jobs/search'
import { qk } from '@/lib/query-keys'
import { apiCalls, callsTo, resetApi, route } from './helpers/api-mock'
import { completeness, ids, job, openResult, profile, quota } from './helpers/fixtures'
import { renderScreen, testQueryClient } from './helpers/render'
import { mockRouter, resetRouter, routeParams } from './helpers/router-mock'

jest.mock('@/lib/api-client', () => jest.requireActual('./helpers/api-mock').apiClientMock())
jest.mock('expo-router', () => jest.requireActual('./helpers/router-mock').expoRouterMock())
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }))

const page = (from: number, count: number, nextCursor: string | null) => ({ items: Array.from({ length: count }, (_, i) => job(from + i)), nextCursor })
const preview = (patch: object = {}) => ({ job: job(1), opensFree: false, quota: quota(4, 10), ...patch })

beforeEach(() => {
  resetApi()
  resetRouter()
})

describe('search helpers', () => {
  it('treats pinyin still being composed after Chinese text as composing', () => {
    expect(looksLikeImeComposing('前端gongc')).toBe(true)
    expect(looksLikeImeComposing('前端工程师')).toBe(false)
    expect(looksLikeImeComposing('react native')).toBe(false)
    expect(looksLikeImeComposing('React 前端')).toBe(false)
  })

  it('builds the jobs query through the shared strict schema', () => {
    expect(jobsPath({})).toBe('/jobs')
    expect(jobsPath({ q: '  前端 ', type: 'INTERNSHIP', sort: 'salary' }, 'abc')).toBe(`/jobs?q=${encodeURIComponent('前端')}&type=INTERNSHIP&sort=salary&cursor=abc`)
    expect(() => jobsPath({ type: 'NOPE' as never })).toThrow()
  })
})

describe('S08 job list', () => {
  it('scrolling through 50 jobs never touches the quota endpoint', async () => {
    route('GET /jobs', (_b: unknown, path: string) => (path.includes('cursor=c2') ? page(41, 10, null) : path.includes('cursor=c1') ? page(21, 20, 'c2') : page(1, 20, 'c1')))
    await renderScreen(<JobsTab />)
    const list = await screen.findByTestId('jobs-list')
    await fireEvent(list, 'endReached')
    await waitFor(() => expect(callsTo('GET', '/jobs?cursor=c1')).toHaveLength(1))
    await fireEvent(list, 'endReached')
    await waitFor(() => expect(callsTo('GET', '/jobs?cursor=c2')).toHaveLength(1))
    expect(apiCalls.filter((c) => c.path.includes('/open') || c.path.includes('/preview'))).toEqual([])
    await fireEvent.press(screen.getByTestId(`job-card-${ids.job(1)}`).children[0] as never)
    expect(mockRouter.push).toHaveBeenCalledWith(`/jobs/${ids.job(1)}`)
  })

  it('searches after a pause, not while the IME is composing, and immediately on submit', async () => {
    route('GET /jobs', page(1, 2, null))
    await renderScreen(<JobsTab />)
    const input = await screen.findByTestId('jobs-search')
    await fireEvent.changeText(input, '前端gongc')
    await new Promise((r) => setTimeout(r, 700))
    expect(apiCalls.filter((c) => c.path.includes('q='))).toEqual([])
    await fireEvent.changeText(input, '前端')
    await waitFor(() => expect(apiCalls.map((c) => c.path)).toContain(`/jobs?q=${encodeURIComponent('前端')}`), { timeout: 2000 })
    await fireEvent(input, 'submitEditing', { nativeEvent: { text: 'react' } })
    await waitFor(() => expect(callsTo('GET', '/jobs?q=react')).toHaveLength(1))
  })

  it('applies filter chips only when "show results" is pressed', async () => {
    route('GET /jobs', page(1, 1, null))
    await renderScreen(<JobsTab />)
    await fireEvent.press(await screen.findByTestId('jobs-filter'))
    await fireEvent.press(screen.getByRole('checkbox', { name: '实习' }))
    await fireEvent.press(screen.getByRole('checkbox', { name: '槟城' }))
    expect(callsTo('GET', '/jobs?type=')).toHaveLength(0)
    await fireEvent.press(screen.getByTestId('filter-apply'))
    await waitFor(() => expect(callsTo('GET', '/jobs?type=INTERNSHIP&state=PNG')).toHaveLength(1))
  })

  it('shows an empty state with a way out, and an error state with retry', async () => {
    route('GET /jobs', { items: [], nextCursor: null })
    const { unmount } = await renderScreen(<JobsTab />, { locale: 'en' })
    expect(await screen.findByText('No jobs match your filters')).toBeOnTheScreen()
    await unmount()
    resetApi()
    await renderScreen(<JobsTab />)
    expect(await screen.findByTestId('error-state')).toBeOnTheScreen()
  })
})

describe('S10 preview → open', () => {
  beforeEach(() => {
    routeParams.current = { id: ids.job(1) }
  })

  it('only opens after an explicit tap and a confirm that shows the remaining quota', async () => {
    route(`GET /jobs/${ids.job(1)}/preview`, preview())
    route(`POST /jobs/${ids.job(1)}/open`, openResult(1))
    await renderScreen(<JobScreen />)
    const button = await screen.findByTestId('job-view-detail')
    expect(button).toHaveTextContent('查看完整详情（本月剩余 6 次）')
    expect(callsTo('POST', '/jobs/')).toHaveLength(0)
    await fireEvent.press(button)
    expect(screen.getByTestId('open-confirm-body')).toHaveTextContent('将使用 1 次本月查看额度，剩余 6 次。')
    expect(callsTo('POST', '/jobs/')).toHaveLength(0)
    await fireEvent.press(screen.getByTestId('open-confirm'))
    expect(await screen.findByTestId('job-detail')).toBeOnTheScreen()
    expect(callsTo('POST', `/jobs/${ids.job(1)}/open`)).toEqual([expect.objectContaining({ userInitiated: true })])
    expect(screen.getByText('负责 React Native 页面开发。')).toBeOnTheScreen()
    await fireEvent.press(screen.getByTestId('job-apply'))
    expect(mockRouter.push).toHaveBeenCalledWith(`/apply/${ids.job(1)}`)
  })

  it('skips the confirm when opening is free', async () => {
    route(`GET /jobs/${ids.job(1)}/preview`, preview({ opensFree: true }))
    route(`POST /jobs/${ids.job(1)}/open`, openResult(1))
    await renderScreen(<JobScreen />)
    const button = await screen.findByTestId('job-view-detail')
    expect(button).toHaveTextContent('查看完整详情')
    await fireEvent.press(button)
    expect(await screen.findByTestId('job-detail')).toBeOnTheScreen()
    expect(screen.queryByTestId('open-confirm')).toBeNull()
  })

  it('shows the locked state with an invite link when the quota is used up', async () => {
    route(`GET /jobs/${ids.job(1)}/preview`, preview({ quota: quota(10, 10) }))
    await renderScreen(<JobScreen />)
    expect(await screen.findByTestId('job-locked')).toBeOnTheScreen()
    await fireEvent.press(screen.getByTestId('job-locked-invite'))
    expect(mockRouter.push).toHaveBeenCalledWith('/invite')
    expect(callsTo('POST', '/jobs/')).toHaveLength(0)
  })

  it('shows the locked state when the server refuses the open', async () => {
    route(`GET /jobs/${ids.job(1)}/preview`, preview({ quota: quota(9, 10) }))
    route(`POST /jobs/${ids.job(1)}/open`, openResult(1, { allowed: false, detail: null, quota: quota(10, 10) }))
    await renderScreen(<JobScreen />)
    await fireEvent.press(await screen.findByTestId('job-view-detail'))
    await fireEvent.press(screen.getByTestId('open-confirm'))
    expect(await screen.findByTestId('job-locked')).toBeOnTheScreen()
  })

  it('reuses a previous open result instead of calling open again', async () => {
    const client = testQueryClient()
    client.setQueryData(qk.jobOpen(ids.job(1)), openResult(1, { application: { id: ids.application, status: 'APPLIED', canWithdraw: true } }))
    await renderScreen(<JobScreen />, { client })
    expect(await screen.findByTestId('job-view-application')).toHaveTextContent('已投递 · 待处理')
    expect(apiCalls.filter((c) => c.method === 'POST')).toEqual([])
    // 失效和重取这个缓存项都不会触发 open
    await client.invalidateQueries()
    await client.refetchQueries()
    expect(apiCalls.filter((c) => c.path.includes('/open'))).toEqual([])
  })

  it('never shows a salary the server hid', async () => {
    route(`GET /jobs/${ids.job(1)}/preview`, preview({ job: job(1, { salaryMin: null, salaryMax: null }) }))
    await renderScreen(<JobScreen />)
    expect(await screen.findByText('薪资面议')).toBeOnTheScreen()
  })
})

describe('S07 home', () => {
  it('shows greeting, onboarding, quota and recommendations without counting', async () => {
    route('GET /profile', profile)
    route('GET /profile/completeness', completeness())
    route('GET /referrals/me', { code: 'ABC123', inviteLink: 'https://example.test/r/ABC123', quota: quota(4, 10), tierSize: 3, tierBonus: 5, unlimitedAt: 10, referrals: [] })
    route('GET /jobs', page(1, 8, 'c1'))
    route('GET /notifications', { items: [], nextCursor: null, unreadCount: 3 })
    await renderScreen(<Home />)
    expect(await screen.findByText('你好，李同学')).toBeOnTheScreen()
    expect(await screen.findByTestId('home-quota')).toHaveTextContent('本月还可查看 6 个职位详情')
    expect(await screen.findByTestId(`job-card-${ids.job(5)}`)).toBeOnTheScreen()
    expect(screen.queryByTestId(`job-card-${ids.job(6)}`)).toBeNull()
    expect(await screen.findByRole('button', { name: '通知，3 条未读' })).toBeOnTheScreen()
    await fireEvent.press(screen.getByTestId('home-onboarding'))
    expect(mockRouter.push).toHaveBeenCalledWith('/onboarding')
    expect(apiCalls.filter((c) => c.path.includes('/open') || c.path.includes('/preview'))).toEqual([])
  })
})
