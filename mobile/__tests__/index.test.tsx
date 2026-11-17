import { render, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import Gate from '../app/index'
import Welcome from '../app/(auth)/welcome'
import { AppIntlProvider } from '@/i18n/provider'

const mockUseMe = jest.fn()
jest.mock('@/features/auth/use-me', () => ({ useMe: () => mockUseMe() }))
const mockRedirect = jest.fn()
const mockPush = jest.fn()
jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => {
    mockRedirect(href)
    return null
  },
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
}))

const metrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } }
const wrap = (ui: React.ReactElement, locale: 'zh' | 'en' = 'zh') =>
  render(
    <SafeAreaProvider initialMetrics={metrics}>
      <AppIntlProvider locale={locale}>{ui}</AppIntlProvider>
    </SafeAreaProvider>,
  )

beforeEach(() => {
  mockRedirect.mockReset()
  mockUseMe.mockReset()
})

describe('Gate (app/index)', () => {
  it.each([
    [{ loading: false, signedIn: false, me: null }, '/welcome'],
    [{ loading: false, signedIn: true, me: { role: 'STUDENT' } }, '/home'],
    [{ loading: false, signedIn: true, me: { role: 'EMPLOYER' } }, '/employer'],
    [{ loading: false, signedIn: true, me: { role: 'ADMIN' } }, '/employer'],
  ])('routes %j to %s', async (state, href) => {
    mockUseMe.mockReturnValue({ error: null, refetch: jest.fn(), ...state })
    await wrap(<Gate />)
    expect(mockRedirect).toHaveBeenCalledWith(href)
  })

  it('shows the wordmark while loading', async () => {
    mockUseMe.mockReturnValue({ loading: true, signedIn: false, me: null, error: null, refetch: jest.fn() })
    await wrap(<Gate />)
    expect(screen.getByRole('header')).toHaveTextContent('FindMYJob')
    expect(mockRedirect).not.toHaveBeenCalled()
  })
})

describe('Welcome', () => {
  it.each([
    ['zh', '找到我的 对口 工作', '注册'],
    ['en', 'Finding my right Job', 'Sign up'],
  ] as const)('renders brand line and actions (%s)', async (locale, line, signUp) => {
    await wrap(<Welcome />, locale)
    expect(screen.getByText(line)).toBeOnTheScreen()
    expect(screen.getByRole('button', { name: signUp })).toBeOnTheScreen()
  })
})
