import { fireEvent, screen, waitFor } from '@testing-library/react-native'
import * as SecureStore from 'expo-secure-store'
import * as WebBrowser from 'expo-web-browser'
import { Share, Text } from 'react-native'

import MeTab from '../app/(tabs)/me'
import DeleteAccount from '../app/delete-account'
import Help from '../app/help'
import Invite from '../app/invite'
import Privacy from '../app/privacy'
import Settings from '../app/settings'
import { PreferencesProvider } from '@/features/settings/prefs'
import { onAppEvent } from '@/lib/app-events'
import { useTheme } from '@/theme/use-theme'
import { callsTo, resetApi, route } from './helpers/api-mock'
import { completeness, quota } from './helpers/fixtures'
import { renderScreen } from './helpers/render'
import { mockRouter, resetRouter } from './helpers/router-mock'

jest.mock('@/lib/api-client', () => jest.requireActual('./helpers/api-mock').apiClientMock())
jest.mock('expo-router', () => jest.requireActual('./helpers/router-mock').expoRouterMock())
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }))
jest.mock('expo-secure-store', () => ({ getItem: jest.fn(() => null), setItem: jest.fn() }))

beforeEach(() => {
  resetApi()
  resetRouter()
  ;(SecureStore.setItem as jest.Mock).mockClear()
  // 本机已存过中文（测试环境的系统语言不一定是中文）
  ;(SecureStore.getItem as jest.Mock).mockImplementation((key: string) => (key === 'findmyjob.pref.locale' ? 'zh' : null))
})

function SchemeProbe() {
  return <Text testID="scheme">{useTheme().scheme}</Text>
}

describe('S21 settings', () => {
  beforeEach(() => {
    route('GET /me/notification-prefs', { weeklyDigest: { available: true, granted: false }, legalVersion: '2026-10' })
  })

  it('switches language immediately, persists it locally and syncs it to the server', async () => {
    route('PATCH /me/locale', { locale: 'en' })
    await renderScreen(
      <PreferencesProvider>
        <Settings />
      </PreferencesProvider>,
    )
    expect(await screen.findByText('语言')).toBeOnTheScreen()
    await fireEvent.press(screen.getByTestId('locale-en'))
    expect(await screen.findByText('Language')).toBeOnTheScreen()
    expect(SecureStore.setItem).toHaveBeenCalledWith('findmyjob.pref.locale', 'en')
    await waitFor(() => expect(callsTo('PATCH', '/me/locale')[0]?.body).toEqual({ locale: 'en' }))
  })

  it('overrides the system color scheme and remembers it', async () => {
    await renderScreen(
      <PreferencesProvider>
        <Settings />
        <SchemeProbe />
      </PreferencesProvider>,
    )
    expect(screen.getByTestId('scheme')).toHaveTextContent('light')
    await fireEvent.press(screen.getByTestId('theme-dark'))
    expect(screen.getByTestId('scheme')).toHaveTextContent('dark')
    expect(screen.getByRole('radio', { name: '深色' })).toBeChecked()
    expect(SecureStore.setItem).toHaveBeenCalledWith('findmyjob.pref.theme', 'dark')
  })

  it('turns on the weekly digest with the current legal version', async () => {
    route('PUT /me/notification-prefs', { weeklyDigest: { available: true, granted: true }, legalVersion: '2026-10' })
    await renderScreen(<Settings />)
    const sw = await screen.findByRole('switch', { name: '每周职位周报邮件' })
    await waitFor(() => expect(sw).toBeEnabled())
    await fireEvent.press(sw)
    await waitFor(() => expect(callsTo('PUT', '/me/notification-prefs')[0]?.body).toEqual({ granted: true, submittedVersion: '2026-10' }))
  })
})

describe('S20 privacy', () => {
  const privacy = {
    talentPoolVisible: true,
    blockedCompanies: [{ companyId: 'ccompany00000000000000009', companyName: '已屏蔽公司', blockedAt: '2026-11-01T00:00:00.000Z' }],
    profileViews: [],
    unlocks: [{ companyId: 'ccompany00000000000000001', companyName: '示例科技', unlockedAt: '2026-11-02T00:00:00.000Z', source: 'APPLICATION' }],
  }

  it('toggles talent-pool visibility, blocks and unblocks companies, requests an export', async () => {
    route('GET /privacy', privacy)
    route('PUT /privacy', {})
    route('GET /privacy/companies', { items: [{ id: 'ccompany00000000000000002', name: '另一家公司' }] })
    route('POST /privacy/blocked-companies', {})
    route('DELETE /privacy/blocked-companies/ccompany00000000000000009', {})
    route('POST /data-requests/export', { requestId: 'cexport000000000000000001', existing: false })
    await renderScreen(<Privacy />)
    await fireEvent.press(await screen.findByTestId('privacy-visibility'))
    await waitFor(() => expect(callsTo('PUT', '/privacy')[0]?.body).toEqual({ granted: false }))

    await fireEvent.changeText(screen.getByTestId('privacy-block-search'), '另一家')
    await fireEvent.press(await screen.findByTestId('block-ccompany00000000000000002', {}, { timeout: 2000 }))
    await waitFor(() => expect(callsTo('POST', '/privacy/blocked-companies')[0]?.body).toEqual({ companyId: 'ccompany00000000000000002' }))
    expect(callsTo('GET', '/privacy/companies')[0]?.path).toBe(`/privacy/companies?query=${encodeURIComponent('另一家')}`)

    await fireEvent.press(screen.getByTestId('unblock-ccompany00000000000000009'))
    await waitFor(() => expect(callsTo('DELETE', '/privacy/blocked-companies/ccompany00000000000000009')).toHaveLength(1))
    expect(screen.getByLabelText('示例科技, 投递自动授权')).toBeOnTheScreen()

    await fireEvent.press(screen.getByTestId('privacy-export'))
    expect(await screen.findByText('导出请求已提交，完成后我们会发邮件通知你。')).toBeOnTheScreen()
    await fireEvent.press(screen.getByTestId('privacy-delete'))
    expect(mockRouter.push).toHaveBeenCalledWith('/delete-account')
  })
})

describe('account deletion', () => {
  it('needs the typed phrase and a final confirm, then signs out locally', async () => {
    route('POST /account/delete', {})
    const events: string[] = []
    const off = onAppEvent((e) => events.push(e))
    await renderScreen(<DeleteAccount />)
    expect(screen.getByTestId('delete-continue')).toBeDisabled()
    await fireEvent.changeText(screen.getByTestId('delete-phrase'), '删除')
    expect(screen.getByTestId('delete-continue')).toBeDisabled()
    await fireEvent.changeText(screen.getByTestId('delete-phrase'), '确认删除')
    await fireEvent.press(screen.getByTestId('delete-continue'))
    expect(callsTo('POST', '/account/delete')).toHaveLength(0)
    await fireEvent.press(screen.getByTestId('delete-final'))
    await waitFor(() => expect(events).toEqual(['signed-out']))
    expect(callsTo('POST', '/account/delete')[0]?.body).toEqual({ confirm: true })
    off()
  })
})

describe('S19 invite and S24 help', () => {
  it('shows the code and opens the system share sheet', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never)
    route('GET /referrals/me', { code: 'ABC123', inviteLink: 'https://example.test/r/ABC123', quota: quota(10, 10), tierSize: 3, tierBonus: 5, unlimitedAt: 10, referrals: [{ id: 'cref00000000000000000001', status: 'QUALIFIED', inviteeName: '王**', inviteeCompleteness: 80 }] })
    await renderScreen(<Invite />)
    expect(await screen.findByTestId('invite-code')).toHaveTextContent('ABC123')
    expect(screen.getByTestId('invite-progress')).toHaveTextContent('已使用 10 / 10 次')
    expect(screen.getByLabelText('王**，完成度 80%，已生效')).toBeOnTheScreen()
    await fireEvent.press(screen.getByTestId('invite-share'))
    expect(share).toHaveBeenCalledWith({ message: expect.stringContaining('ABC123') })
  })

  it('links to the web safety page in the current language', async () => {
    await renderScreen(<Help />, { locale: 'en' })
    await fireEvent.press(screen.getByTestId('help-safety-web'))
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(expect.stringMatching(/\/en\/safety$/))
  })
})

describe('me tab', () => {
  it('links every section of the menu', async () => {
    route('GET /profile/completeness', completeness({ schoolVerified: true }))
    await renderScreen(<MeTab />)
    expect(await screen.findByRole('button', { name: '学校认证, 已认证' })).toBeOnTheScreen()
    for (const [id, href] of [
      ['me-profile', '/profile'],
      ['me-resumes', '/resumes'],
      ['me-invite', '/invite'],
      ['me-privacy', '/privacy'],
      ['me-settings', '/settings'],
      ['me-help', '/help'],
    ]) {
      await fireEvent.press(screen.getByTestId(id!))
      expect(mockRouter.push).toHaveBeenLastCalledWith(href)
    }
  })
})
