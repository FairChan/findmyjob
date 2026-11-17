import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import * as DocumentPicker from 'expo-document-picker'

import CompanyScreen from '../app/companies/[id]'
import Companies from '../app/companies/index'
import Notifications from '../app/notifications'
import EditProfileSection from '../app/profile/edit'
import ProfileScreen from '../app/profile/index'
import Contact from '../app/contact'
import Resumes from '../app/resumes'
import { notificationKey, notificationTarget } from '@/features/notifications/api'
import { localResumeProblem } from '@/features/resume/api'
import { ApiError } from '@/lib/api-client'
import { apiCalls, callsTo, resetApi, route } from './helpers/api-mock'
import { company, completeness, ids, profile, schools } from './helpers/fixtures'
import { renderScreen } from './helpers/render'
import { mockRouter, resetRouter, routeParams } from './helpers/router-mock'

jest.mock('@/lib/api-client', () => jest.requireActual('./helpers/api-mock').apiClientMock())
jest.mock('expo-router', () => jest.requireActual('./helpers/router-mock').expoRouterMock())
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }))
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }))

const fetchMock = jest.fn()
beforeEach(() => {
  resetApi()
  resetRouter()
  fetchMock.mockReset()
  global.fetch = fetchMock as unknown as typeof fetch
})

describe('S15 companies', () => {
  const listItem = { ...company, hasLogo: false, state: 'SGR', city: 'Petaling Jaya', publishedJobCount: 3 }

  it('lists verified companies and filters by tag', async () => {
    route('GET /companies', { items: [listItem], nextCursor: null })
    route('GET /companies?tag=ALUMNI', { items: [], nextCursor: null })
    await renderScreen(<Companies />)
    expect(await screen.findByRole('button', { name: '示例科技，已认证企业，Petaling Jaya · 雪兰莪，3 个在招职位' })).toBeOnTheScreen()
    await fireEvent.press(screen.getByRole('checkbox', { name: '校友企业' }))
    await waitFor(() => expect(callsTo('GET', '/companies?tag=ALUMNI')).toHaveLength(1))
    expect(await screen.findByText('暂无合作企业')).toBeOnTheScreen()
  })

  it('shows company detail with jobs that open the (free) preview', async () => {
    routeParams.current = { id: ids.company }
    route(`GET /companies/${ids.company}`, {
      company: { ...company, description: null, website: 'javascript:alert(1)', hasLogo: false, state: null, city: null, industryCode: null, size: null, isFoundingPartner: true },
      jobs: { items: [{ id: ids.job(1), title: '后端实习生', type: 'INTERNSHIP', workMode: 'ONSITE', state: 'KUL', city: null, salaryMin: null, salaryMax: null, acceptsStudentPass: true, sponsorsWorkPass: false }], nextCursor: null },
    })
    await renderScreen(<CompanyScreen />)
    expect(await screen.findByText('该企业暂未添加简介。')).toBeOnTheScreen()
    expect(screen.queryByRole('button', { name: '访问企业官网' })).toBeNull()
    await fireEvent.press(screen.getByRole('button', { name: /后端实习生/ }))
    expect(mockRouter.push).toHaveBeenCalledWith(`/jobs/${ids.job(1)}`)
    expect(apiCalls.filter((c) => c.path.includes('/open'))).toEqual([])
  })
})

describe('S16 notifications', () => {
  it('maps types to the same labels and targets as the web', () => {
    expect(notificationKey('application.status.changed')).toBe('applicationStatusChanged')
    expect(notificationKey('something.new')).toBe('unknownType')
    expect(notificationTarget('invitation.received')).toBe('/applications?tab=invitations')
    expect(notificationTarget('system.alert')).toBeNull()
  })

  it('marks one as read on tap and all as read from the header', async () => {
    const n = (id: string, type: string, readAt: string | null) => ({ id, type, readAt, createdAt: '2026-11-17T03:00:00.000Z' })
    route('GET /notifications', { items: [n('cnotif0000000000000000001', 'invitation.received', null), n('cnotif0000000000000000002', 'mystery', '2026-11-17T04:00:00.000Z')], nextCursor: null, unreadCount: 1 })
    route('POST /notifications/read', {})
    await renderScreen(<Notifications />)
    expect(await screen.findByRole('button', { name: /未读，收到企业邀请/ })).toBeOnTheScreen()
    expect(screen.getByText('通知')).toBeOnTheScreen()
    await fireEvent.press(screen.getByTestId('notification-cnotif0000000000000000001'))
    expect(callsTo('POST', '/notifications/read')[0]?.body).toEqual({ ids: ['cnotif0000000000000000001'] })
    expect(mockRouter.push).toHaveBeenCalledWith('/applications?tab=invitations')
    await fireEvent.press(screen.getByTestId('notifications-read-all'))
    await waitFor(() => expect(callsTo('POST', '/notifications/read')[1]?.body).toEqual({ all: true }))
  })
})

describe('S17 profile', () => {
  beforeEach(() => {
    route('GET /profile', profile)
    route('GET /profile/completeness', completeness())
    route('GET /schools', schools)
  })

  it('shows each section with labels from the web profile', async () => {
    await renderScreen(<ProfileScreen />)
    expect(await screen.findByLabelText('就读院校: 示例大学马来西亚分校')).toBeOnTheScreen()
    expect(screen.getByLabelText('工作资格: 学生准证')).toBeOnTheScreen()
    expect(screen.getByLabelText('意向州属: 吉隆坡')).toBeOnTheScreen()
    await fireEvent.press(screen.getByTestId('profile-edit-basic'))
    expect(mockRouter.push).toHaveBeenCalledWith('/profile/edit?section=basic')
  })

  it('edits skills and saves the whole section', async () => {
    routeParams.current = { section: 'skills' }
    route('PUT /profile/skills', {})
    await renderScreen(<EditProfileSection />)
    await fireEvent.changeText(await screen.findByTestId('field-skill'), 'TypeScript')
    await fireEvent.press(screen.getByTestId('add-skill'))
    await fireEvent.press(screen.getByRole('button', { name: '删除技能 React' }))
    await fireEvent.press(screen.getByTestId('profile-save'))
    await waitFor(() => expect(callsTo('PUT', '/profile/skills')).toHaveLength(1))
    expect(callsTo('PUT', '/profile/skills')[0]?.body).toEqual({ languages: [{ language: 'zh', level: 'NATIVE' }], skills: ['TypeScript'], headline: null, summary: null })
  })
})

describe('S18 resume upload', () => {
  it('rejects oversized or non-PDF files before uploading', () => {
    expect(localResumeProblem({ uri: 'file:///a.pdf', name: 'a.pdf', size: 6 * 1024 * 1024, mimeType: 'application/pdf' })).toBe('FILE_TOO_LARGE')
    expect(localResumeProblem({ uri: 'file:///a.docx', name: 'a.docx', size: 1000, mimeType: 'application/msword' })).toBe('INVALID_FILE_TYPE')
    expect(localResumeProblem({ uri: 'file:///a.pdf', name: 'CV.PDF', size: null, mimeType: null })).toBeNull()
  })

  it('picks a PDF with the system picker and posts multipart to /api/uploads/RESUME with app headers', async () => {
    route('GET /resumes', { items: [] })
    ;(DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/cv.pdf', name: 'cv.pdf', size: 1024, mimeType: 'application/pdf' }] })
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, key: 'resumes/x/y.pdf', resumeId: ids.resume }) })
    await renderScreen(<Resumes />)
    expect(await screen.findByText('还没有上传简历')).toBeOnTheScreen()
    await fireEvent.press(screen.getByTestId('resume-upload'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/api\/uploads\/RESUME$/)
    expect(init.credentials).toBe('omit')
    expect(init.headers).toMatchObject({ 'expo-origin': 'findmyjob-dev://', 'x-app-version': expect.any(String) })
    expect(init.headers['Content-Type']).toBeUndefined()
    expect(init.body).toBeInstanceOf(FormData)
    expect(await screen.findByText('简历已上传')).toBeOnTheScreen()
  })

  it('maps server-side PDF rejections to the web resume messages', async () => {
    route('GET /resumes', { items: [] })
    ;(DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/cv.pdf', name: 'cv.pdf', size: 1024, mimeType: 'application/pdf' }] })
    fetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ ok: false, code: 'ENCRYPTED_PDF' }) })
    await renderScreen(<Resumes />)
    await fireEvent.press(await screen.findByTestId('resume-upload'))
    expect(await screen.findByText('不支持加密的 PDF')).toBeOnTheScreen()
  })

  it('sets a primary resume and deletes one only after confirming', async () => {
    const resume = (id: string, isPrimary: boolean, fileName: string) => ({ id, fileName, isPrimary, sizeBytes: 1024, pageCount: 1, createdAt: '2026-11-10T00:00:00.000Z' })
    route('GET /resumes', { items: [resume(ids.resume, true, 'cv-zh.pdf'), resume(ids.resume2, false, 'cv-en.pdf')] })
    route(`POST /resumes/${ids.resume2}/primary`, {})
    route(`DELETE /resumes/${ids.resume2}`, {})
    await renderScreen(<Resumes />)
    expect(await screen.findByTestId(`resume-${ids.resume}`)).toHaveTextContent(/主简历/)
    expect(screen.queryByTestId(`resume-primary-${ids.resume}`)).toBeNull()
    await fireEvent.press(screen.getByTestId(`resume-primary-${ids.resume2}`))
    await waitFor(() => expect(callsTo('POST', `/resumes/${ids.resume2}/primary`)).toHaveLength(1))
    expect(await screen.findByText('已设为主简历')).toBeOnTheScreen()
    await fireEvent.press(screen.getByTestId(`resume-delete-${ids.resume2}`))
    expect(callsTo('DELETE', '/resumes/')).toHaveLength(0)
    await fireEvent.press(screen.getByTestId('resume-delete-confirm'))
    await waitFor(() => expect(callsTo('DELETE', `/resumes/${ids.resume2}`)).toHaveLength(1))
  })
})

describe('contact details', () => {
  it('shows the saved contact and replaces the whole record on save', async () => {
    route('GET /contact', { phone: '+60123456789', email: null, whatsapp: null, wechat: 'wx_test', linkedinUrl: null })
    route('PUT /contact', (body: unknown) => body)
    route('GET /profile', profile)
    await renderScreen(<Contact />)
    expect(await screen.findByTestId('contact-phone')).toHaveDisplayValue('+60123456789')
    await fireEvent.changeText(screen.getByTestId('contact-wechat'), '  ')
    await fireEvent.changeText(screen.getByTestId('contact-email'), 'li@example.test')
    await fireEvent.press(screen.getByTestId('contact-save'))
    await waitFor(() => expect(callsTo('PUT', '/contact')).toHaveLength(1))
    expect(callsTo('PUT', '/contact')[0]?.body).toEqual({ phone: '+60123456789', email: 'li@example.test', whatsapp: null, wechat: null, linkedinUrl: null })
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled())
  })

  it('explains format problems the server rejects', async () => {
    route('GET /contact', { phone: null, email: null, whatsapp: null, wechat: null, linkedinUrl: null })
    route('PUT /contact', () => {
      throw new ApiError('VALIDATION_ERROR', 400)
    })
    await renderScreen(<Contact />)
    await fireEvent.changeText(await screen.findByTestId('contact-phone'), '0123')
    await fireEvent.press(screen.getByTestId('contact-save'))
    expect(await screen.findByTestId('contact-error')).toHaveTextContent(/国际区号/)
  })
})
