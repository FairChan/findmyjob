import { fireEvent, screen, waitFor } from '@testing-library/react-native'

import ApplicationsTab from '../app/(tabs)/applications'
import ApplicationDetail from '../app/applications/[id]'
import ApplyScreen from '../app/apply/[jobId]'
import { ApiError } from '@/lib/api-client'
import { qk } from '@/lib/query-keys'
import { apiCalls, callsTo, resetApi, route } from './helpers/api-mock'
import { company, ids, openResult } from './helpers/fixtures'
import { renderScreen, testQueryClient } from './helpers/render'
import { mockRouter, resetRouter, routeParams } from './helpers/router-mock'

jest.mock('@/lib/api-client', () => jest.requireActual('./helpers/api-mock').apiClientMock())
jest.mock('expo-router', () => jest.requireActual('./helpers/router-mock').expoRouterMock())
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }))

const application = (id: string, status: string, patch: object = {}) => ({
  id,
  status,
  coverNote: null,
  createdAt: '2026-11-10T02:00:00.000Z',
  canWithdraw: status === 'APPLIED',
  job: { id: ids.job(1), title: '前端实习生 1', companyName: '示例科技' },
  ...patch,
})
const future = new Date(Date.now() + 7 * 86400_000).toISOString()
const invitation = (id: string, patch: object = {}) => ({
  id,
  status: 'SENT',
  message: '我们很喜欢你的项目经历',
  expiresAt: future,
  createdAt: '2026-11-10T02:00:00.000Z',
  respondedAt: null,
  applicationId: null,
  job: { id: ids.job(2), title: '数据分析实习生', type: 'INTERNSHIP', workMode: 'REMOTE', city: null, salaryMin: null, salaryMax: null },
  company,
  ...patch,
})

function withOpen(patch: Parameters<typeof openResult>[1] = {}) {
  const client = testQueryClient()
  client.setQueryData(qk.jobOpen(ids.job(1)), openResult(1, patch))
  return client
}

beforeEach(() => {
  resetApi()
  resetRouter()
})

describe('S11 apply confirm', () => {
  beforeEach(() => {
    routeParams.current = { jobId: ids.job(1) }
  })

  it('applies with the primary resume, shows the anti-scam reminder and never calls open', async () => {
    route('POST /applications', { applicationId: ids.application })
    await renderScreen(<ApplyScreen />, { client: withOpen() })
    expect(screen.getByTestId('apply-safety')).toHaveTextContent(/诈骗/)
    expect(screen.getByRole('radio', { name: 'resume-zh.pdf（主简历）' })).toBeChecked()
    await fireEvent.press(screen.getByTestId(`apply-resume-${ids.resume2}`))
    await fireEvent.changeText(screen.getByTestId('apply-cover-note'), '  期待加入  ')
    await fireEvent.press(screen.getByTestId('apply-submit'))
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith(`/applications/${ids.application}?justApplied=1`))
    expect(callsTo('POST', '/applications')[0]?.body).toEqual({ jobId: ids.job(1), resumeId: ids.resume2, coverNote: '期待加入' })
    expect(apiCalls.filter((c) => c.path.includes('/open'))).toEqual([])
  })

  it('lists what is missing with links and blocks submit', async () => {
    await renderScreen(<ApplyScreen />, { client: withOpen({ applyBlocker: 'contactAndResume', resumes: [] }) })
    expect(screen.getByTestId('apply-blocker')).toHaveTextContent(/联系方式和简历/)
    expect(screen.getByTestId('apply-submit')).toBeDisabled()
    await fireEvent.press(screen.getByTestId('apply-fix-resume'))
    expect(mockRouter.push).toHaveBeenCalledWith('/resumes')
    expect(screen.getByTestId('apply-fix-contact')).toBeOnTheScreen()
  })

  it('maps server refusals to readable messages', async () => {
    route('POST /applications', () => {
      throw new ApiError('COMPLETENESS_LOW', 422)
    })
    await renderScreen(<ApplyScreen />, { client: withOpen() })
    await fireEvent.press(screen.getByTestId('apply-submit'))
    expect(await screen.findByTestId('apply-error')).toHaveTextContent('档案完成度不足，先完善档案再投递')
  })

  it('without a prior open, asks the user to go back instead of opening on their behalf', async () => {
    await renderScreen(<ApplyScreen />)
    expect(screen.getByText('请先查看职位详情')).toBeOnTheScreen()
    expect(apiCalls).toEqual([])
  })
})

describe('S12/S13 applications', () => {
  it('splits active and closed applications', async () => {
    route('GET /applications', { items: [application(ids.application, 'INTERVIEW'), application('capplication0000000000002', 'REJECTED')], nextCursor: null })
    route('GET /invitations', { items: [], nextCursor: null })
    await renderScreen(<ApplicationsTab />)
    expect(await screen.findByTestId(`application-${ids.application}`)).toBeOnTheScreen()
    expect(screen.queryByTestId('application-capplication0000000000002')).toBeNull()
    await fireEvent.press(screen.getByTestId('segment-closed'))
    expect(await screen.findByTestId('application-capplication0000000000002')).toBeOnTheScreen()
    expect(screen.getByRole('tab', { name: '已结束' })).toBeSelected()
  })

  it('shows the timeline and withdraws only after confirming', async () => {
    routeParams.current = { id: ids.application }
    let withdrawn = false
    route('GET /applications', () => ({ items: [application(ids.application, withdrawn ? 'WITHDRAWN' : 'APPLIED')], nextCursor: null }))
    route(`GET /applications/${ids.application}/timeline`, { events: [{ id: 'cevent0000000000000000001', fromStatus: null, toStatus: 'APPLIED', createdAt: '2026-11-10T02:00:00.000Z' }] })
    route(`POST /applications/${ids.application}/withdraw`, () => {
      withdrawn = true
      return {}
    })
    await renderScreen(<ApplicationDetail />)
    expect(await screen.findByTestId('application-timeline')).toHaveTextContent(/待处理/)
    await fireEvent.press(screen.getByTestId('withdraw'))
    expect(callsTo('POST', '/applications/')).toHaveLength(0)
    await fireEvent.press(screen.getByTestId('withdraw-confirm'))
    await waitFor(() => expect(callsTo('POST', `/applications/${ids.application}/withdraw`)).toHaveLength(1))
    await waitFor(() => expect(screen.queryByTestId('withdraw')).toBeNull())
  })
})

describe('S14 invitations', () => {
  beforeEach(() => {
    route('GET /applications', { items: [], nextCursor: null })
  })

  it('accepts an invitation (= apply) and opens the new application', async () => {
    route('GET /invitations', { items: [invitation(ids.invitation)], nextCursor: null })
    route(`POST /invitations/${ids.invitation}/accept`, { applicationId: ids.application })
    await renderScreen(<ApplicationsTab />)
    await fireEvent.press(screen.getByTestId('segment-invitations'))
    expect(await screen.findByText('示例科技 邀请你投递「数据分析实习生」')).toBeOnTheScreen()
    expect(screen.getByRole('tab', { name: '收到的邀请 (1)' })).toBeOnTheScreen()
    await fireEvent.press(screen.getByTestId(`invitation-accept-${ids.invitation}`))
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith(`/applications/${ids.application}?justApplied=1`))
  })

  it('declines only after confirming, and hides actions on expired invitations', async () => {
    route('GET /invitations', {
      items: [invitation(ids.invitation), invitation('cinvitation00000000000002', { expiresAt: '2026-01-01T00:00:00.000Z' })],
      nextCursor: null,
    })
    route(`POST /invitations/${ids.invitation}/decline`, {})
    routeParams.current = { tab: 'invitations' }
    await renderScreen(<ApplicationsTab />)
    expect(await screen.findByTestId('invitation-cinvitation00000000000002')).toHaveTextContent(/已过期/)
    expect(screen.queryByTestId('invitation-accept-cinvitation00000000000002')).toBeNull()
    await fireEvent.press(screen.getByTestId(`invitation-decline-${ids.invitation}`))
    expect(callsTo('POST', '/invitations/')).toHaveLength(0)
    await fireEvent.press(screen.getByTestId('decline-confirm'))
    await waitFor(() => expect(callsTo('POST', `/invitations/${ids.invitation}/decline`)).toHaveLength(1))
  })
})
