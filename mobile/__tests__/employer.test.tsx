import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import * as ScreenCapture from 'expo-screen-capture'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

import Dashboard from '../app/e/(tabs)/dashboard'
import EmployerJobs from '../app/e/(tabs)/jobs'
import TalentSearch from '../app/e/(tabs)/talent'
import ApplicantDetail from '../app/e/applicant/[id]'
import CandidateScreen from '../app/e/candidate/[id]'
import InviteCandidate from '../app/e/invite/[studentId]'
import { ApiError } from '@/lib/api-client'
import { shouldPersistQuery } from '@/lib/query-persist'
import { apiCalls, callsTo, resetApi, route } from './helpers/api-mock'
import { renderScreen, testQueryClient } from './helpers/render'
import { mockRouter, resetRouter, routeParams } from './helpers/router-mock'

jest.mock('@/lib/api-client', () => jest.requireActual('./helpers/api-mock').apiClientMock())
jest.mock('expo-router', () => jest.requireActual('./helpers/router-mock').expoRouterMock())
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }))
jest.mock('expo-screen-capture', () => ({ preventScreenCaptureAsync: jest.fn(async () => {}), allowScreenCaptureAsync: jest.fn(async () => {}) }))

// 合成数据：未解锁时名字是服务端打码后的样子
const SID = 'cstudent00000000000000001'
const JOB = 'cjob000000000000000000001'
const APP = 'capplication0000000000001'
const card = (patch: object = {}) => ({
  id: SID,
  name: '李**',
  unlocked: false,
  school: { id: 'cschool000000000000000001', nameZh: '示例大学', nameEn: 'Example University' },
  major: '计算机科学',
  degreeLevel: 'BACHELOR',
  graduationYear: 2027,
  cgpa: '3.50',
  skills: ['React'],
  headline: null,
  completeness: 80,
  workAuth: 'STUDENT_PASS',
  lastActiveAt: null,
  ...patch,
})
const detail = (patch: object = {}) => ({ ...card(), summary: '[已隐藏]', educations: [], experiences: [], resumeCount: 1, resumeIds: [], contact: null, ...patch })
const page = (cursor: string | null) => ({ items: [card()], total: 40, nextCursor: cursor, maxPage: 25 })

beforeEach(() => {
  resetApi()
  resetRouter()
  ;(ScreenCapture.preventScreenCaptureAsync as jest.Mock).mockClear()
  ;(ScreenCapture.allowScreenCaptureAsync as jest.Mock).mockClear()
})

describe('E05 talent search (counted)', () => {
  it('does not search on mount, only on explicit taps, and next page needs its own tap', async () => {
    route('GET /e/talent', (_b: unknown, path: string) => (path.includes('cursor=2') ? page(null) : page('2')))
    const client = testQueryClient()
    await renderScreen(<TalentSearch />, { client })
    expect(apiCalls).toEqual([])
    await fireEvent.changeText(screen.getByTestId('e-talent-keyword'), '前端')
    expect(apiCalls).toEqual([])
    await fireEvent.press(screen.getByTestId('e-talent-search'))
    await waitFor(() => expect(callsTo('GET', '/e/talent')).toHaveLength(1))
    expect(callsTo('GET', '/e/talent')[0]).toMatchObject({ userInitiated: true, path: `/e/talent?keyword=${encodeURIComponent('前端')}` })
    expect(await screen.findByTestId(`e-talent-${SID}`)).toBeOnTheScreen()
    // 滑到底不自动翻页；失效和重取全部缓存也不会再发计数请求
    await fireEvent(screen.getByTestId('e-talent-list'), 'endReached')
    await client.invalidateQueries()
    await client.refetchQueries()
    expect(callsTo('GET', '/e/talent')).toHaveLength(1)
    await fireEvent.press(screen.getByTestId('e-talent-next'))
    await waitFor(() => expect(callsTo('GET', '/e/talent')).toHaveLength(2))
    expect(callsTo('GET', '/e/talent')[1]?.path).toContain('cursor=2')
    await fireEvent.press(screen.getByTestId(`e-talent-${SID}`).children[0] as never)
    expect(mockRouter.push).toHaveBeenCalledWith(`/e/candidate/${SID}`)
  })

  it.each([
    [429, 'RATE_LIMITED', '今日人才库搜索页数已用完'],
    [422, 'VALIDATION_ERROR', '已到人才库允许的最大页数'],
  ])('explains %d %s', async (status, code, text) => {
    route('GET /e/talent', () => {
      throw new ApiError(code, status)
    })
    await renderScreen(<TalentSearch />)
    await fireEvent.press(screen.getByTestId('e-talent-search'))
    expect(await screen.findByTestId('e-talent-error')).toHaveTextContent(new RegExp(text))
    expect(callsTo('GET', '/e/talent')).toHaveLength(1)
  })
})

describe('E06 talent profile, unlock and FLAG_SECURE', () => {
  beforeEach(() => {
    routeParams.current = { id: SID }
    route('GET /e/wallet', { balance: 5 })
  })

  it('protects the screen and loads the counted profile only after a tap', async () => {
    route(`GET /e/talent/${SID}`, { detail: detail(), unlock: { enabled: true, costCredits: 1 } })
    const { unmount } = await renderScreen(<CandidateScreen />)
    expect(ScreenCapture.preventScreenCaptureAsync).toHaveBeenCalledWith(`candidate-${SID}`)
    await waitFor(() => expect(callsTo('GET', '/e/wallet')).toHaveLength(1))
    expect(callsTo('GET', '/e/talent')).toHaveLength(0)
    await fireEvent.press(screen.getByTestId('e-candidate-view'))
    expect(await screen.findByTestId('e-candidate-detail')).toHaveTextContent(/李\*\*/)
    expect(callsTo('GET', `/e/talent/${SID}`)).toEqual([expect.objectContaining({ userInitiated: true })])
    // 未解锁：服务端没给联系方式，页面也没有联系方式一节
    expect(screen.queryByText('联系方式')).toBeNull()
    await unmount()
    expect(ScreenCapture.allowScreenCaptureAsync).toHaveBeenCalledWith(`candidate-${SID}`)
  })

  it('unlocks only after a confirm showing cost and balance, then shows what the API returns', async () => {
    let unlocked = false
    route(`GET /e/talent/${SID}`, () =>
      unlocked
        ? { detail: detail({ name: '李同学', unlocked: true, resumeIds: ['cresume000000000000000001'], contact: { phone: '+60123456789', email: null, whatsapp: null, wechat: null, linkedinUrl: null } }), unlock: { enabled: true, costCredits: 1 } }
        : { detail: detail(), unlock: { enabled: true, costCredits: 1 } },
    )
    route(`POST /e/talent/${SID}/unlock`, () => {
      unlocked = true
      return { unlockId: 'cunlock000000000000000001', alreadyUnlocked: false, balance: 4 }
    })
    await renderScreen(<CandidateScreen />)
    await fireEvent.press(screen.getByTestId('e-candidate-view'))
    await fireEvent.press(await screen.findByTestId('e-candidate-unlock'))
    expect(screen.getByTestId('e-unlock-cost')).toHaveTextContent('将消耗 1 个点数')
    expect(await screen.findByText('当前余额：5 点')).toBeOnTheScreen()
    expect(callsTo('POST', '/e/talent/')).toHaveLength(0)
    await fireEvent.press(screen.getByTestId('e-unlock-confirm'))
    await waitFor(() => expect(callsTo('POST', `/e/talent/${SID}/unlock`)).toEqual([expect.objectContaining({ userInitiated: true })]))
    expect(await screen.findByText('+60123456789')).toBeOnTheScreen()
    expect(screen.getByTestId('e-candidate-detail')).toHaveTextContent(/李同学/)
    expect(screen.queryByTestId('e-candidate-unlock')).toBeNull()
  })

  it('does not retry on 402 and never offers a purchase', async () => {
    route(`GET /e/talent/${SID}`, { detail: detail(), unlock: { enabled: true, costCredits: 1 } })
    route(`POST /e/talent/${SID}/unlock`, () => {
      throw new ApiError('INSUFFICIENT_CREDITS', 402)
    })
    await renderScreen(<CandidateScreen />)
    await fireEvent.press(screen.getByTestId('e-candidate-view'))
    await fireEvent.press(await screen.findByTestId('e-candidate-unlock'))
    await fireEvent.press(screen.getByTestId('e-unlock-confirm'))
    expect(await screen.findByTestId('e-unlock-error')).toHaveTextContent('点数不足，无法解锁。')
    expect(callsTo('POST', `/e/talent/${SID}/unlock`)).toHaveLength(1)
    expect(screen.queryByText(/购买|充值|账单|Buy|Purchase|Billing/i)).toBeNull()
  })

  it('blocks the confirm when the balance is lower than the cost', async () => {
    route('GET /e/wallet', { balance: 0 })
    route(`GET /e/talent/${SID}`, { detail: detail(), unlock: { enabled: true, costCredits: 1 } })
    await renderScreen(<CandidateScreen />)
    await fireEvent.press(screen.getByTestId('e-candidate-view'))
    await fireEvent.press(await screen.findByTestId('e-candidate-unlock'))
    await waitFor(() => expect(screen.getByTestId('e-unlock-confirm')).toBeDisabled())
  })

  it('maps the daily view limit', async () => {
    route(`GET /e/talent/${SID}`, () => {
      throw new ApiError('RATE_LIMITED', 429)
    })
    await renderScreen(<CandidateScreen />)
    await fireEvent.press(screen.getByTestId('e-candidate-view'))
    expect(await screen.findByTestId('e-candidate-error')).toHaveTextContent(/今日查看候选人档案的次数已用完/)
  })
})

describe('E03/E04 applicants', () => {
  const applicant = (status: string) => ({ applicationId: APP, studentId: SID, status, coverNote: '期待加入', companyNote: null, createdAt: '2026-11-10T00:00:00.000Z', profile: detail() })

  it('protects the screen, marks APPLIED as viewed and changes status only after confirming', async () => {
    routeParams.current = { id: APP }
    let status = 'APPLIED'
    route(`GET /e/applications/${APP}`, () => applicant(status))
    route(`POST /e/applications/${APP}/viewed`, () => {
      status = 'VIEWED'
      return {}
    })
    route(`POST /e/applications/${APP}/status`, (body: unknown) => {
      status = (body as { toStatus: string }).toStatus
      return {}
    })
    await renderScreen(<ApplicantDetail />)
    expect(ScreenCapture.preventScreenCaptureAsync).toHaveBeenCalledWith(`applicant-${APP}`)
    // 候选人详情也计每日查看上限：进页面不请求，点了才请求
    expect(apiCalls).toEqual([])
    await fireEvent.press(screen.getByTestId('e-applicant-view'))
    await waitFor(() => expect(callsTo('GET', `/e/applications/${APP}`)).toEqual([expect.objectContaining({ userInitiated: true })]))
    await waitFor(() => expect(apiCalls.map((c) => `${c.method} ${c.path}`)).toContain(`POST /e/applications/${APP}/viewed`))
    expect(screen.getByText('期待加入')).toBeOnTheScreen()
    await fireEvent.press(screen.getByTestId('e-status-select'))
    await fireEvent.press(screen.getByRole('radio', { name: '面试中' }))
    await fireEvent.press(screen.getByTestId('e-status-change'))
    expect(callsTo('POST', `/e/applications/${APP}/status`)).toHaveLength(0)
    await fireEvent.press(screen.getByTestId('e-status-confirm'))
    await waitFor(() => expect(callsTo('POST', `/e/applications/${APP}/status`)[0]?.body).toEqual({ toStatus: 'INTERVIEW', note: null }))
    // 改状态后用缓存更新显示，不重新请求会计数的详情
    expect(await screen.findByText('面试中')).toBeOnTheScreen()
    expect(callsTo('GET', `/e/applications/${APP}`)).toHaveLength(1)
    await fireEvent.press(screen.getByTestId('e-applicant-open-talent'))
    expect(mockRouter.push).toHaveBeenCalledWith(`/e/candidate/${SID}`)
  })
})

describe('E01/E02/E07', () => {
  const job = (status: string) => ({ id: JOB, title: '前端实习生', type: 'INTERNSHIP', category: null, status, state: 'KUL', city: null, workMode: 'HYBRID', salaryMin: null, salaryMax: null, salaryVisible: false, publishedAt: null, closedAt: null, deadline: null, createdAt: '2026-11-01T00:00:00.000Z', applicationCount: 3 })

  it('dashboard shows a read-only balance and no purchase entry', async () => {
    route('GET /e/wallet', { balance: 12 })
    route('GET /e/jobs', { items: [job('PUBLISHED')] })
    route('GET /e/invitations', { usage: { used: 2, quota: 20 }, items: [] })
    await renderScreen(<Dashboard />)
    expect(await screen.findByTestId('e-balance')).toHaveTextContent('12 点')
    expect(await screen.findByTestId('e-jobs-summary')).toHaveTextContent('1 个在招职位，共 3 份投递')
    expect(screen.queryByText(/购买|充值|账单/)).toBeNull()
    expect(apiCalls.filter((c) => c.path.startsWith('/e/talent'))).toEqual([])
  })

  it('closes a published job only after confirming', async () => {
    route('GET /e/jobs', { items: [job('PUBLISHED')] })
    route(`POST /e/jobs/${JOB}/close`, { id: JOB, status: 'CLOSED' })
    await renderScreen(<EmployerJobs />)
    await fireEvent.press(await screen.findByTestId(`e-job-close-${JOB}`))
    expect(callsTo('POST', '/e/jobs/')).toHaveLength(0)
    await fireEvent.press(screen.getByTestId('e-job-close-confirm'))
    await waitFor(() => expect(callsTo('POST', `/e/jobs/${JOB}/close`)).toHaveLength(1))
  })

  it('sends an invitation for a chosen open job', async () => {
    routeParams.current = { studentId: SID }
    route('GET /e/jobs', { items: [job('PUBLISHED'), { ...job('CLOSED'), id: 'cjob000000000000000000002', title: '已关闭职位' }] })
    route('GET /e/invitations', { usage: { used: 2, quota: 20 }, items: [] })
    route('POST /e/invitations', { invitationId: 'cinvitation00000000000001', alreadyExists: false })
    await renderScreen(<InviteCandidate />)
    await fireEvent.press(await screen.findByTestId('e-invite-job'))
    expect(screen.queryByRole('radio', { name: '已关闭职位' })).toBeNull()
    await fireEvent.press(screen.getByRole('radio', { name: '前端实习生' }))
    await fireEvent.press(screen.getByTestId('e-invite-send'))
    await waitFor(() => expect(callsTo('POST', '/e/invitations')[0]?.body).toEqual({ studentId: SID, jobId: JOB, message: null }))
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled())
  })
})

describe('employer data handling', () => {
  it('never writes employer queries to the offline cache', () => {
    for (const key of [['e', 'talentSearch'], ['e', 'talentView', SID], ['e', 'applicant', APP], ['e', 'jobs']]) {
      expect(shouldPersistQuery({ queryKey: key, state: { status: 'success' } } as never)).toBe(false)
    }
  })

  it('has no purchase or billing links in the employer shell', () => {
    const root = join(__dirname, '..')
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]))
    const src = [...walk(join(root, 'app', 'e')), ...walk(join(root, 'src', 'features', 'employer'))].map((f) => readFileSync(f, 'utf8')).join('\n')
    expect(src).not.toMatch(/billing|pricing|purchase|WebBrowser|Linking/i)
  })
})
