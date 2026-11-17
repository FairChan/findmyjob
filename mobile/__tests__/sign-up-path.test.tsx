import { fireEvent, screen, waitFor } from '@testing-library/react-native'

import CheckEmail from '../app/(auth)/check-email'
import SignUp from '../app/(auth)/sign-up'
import Welcome from '../app/(auth)/welcome'
import { renderScreen } from './helpers/render'
import { mockRouter, resetRouter, routeParams } from './helpers/router-mock'

// 主路径 1（Maestro 01-sign-up-verify 的 Jest 版）：欢迎 → 注册 → 去邮箱验证 → 登录。
// 邮件链接验证在浏览器里完成，Jest 里只验证 App 侧的跳转和提交内容。
jest.mock('expo-router', () => jest.requireActual('./helpers/router-mock').expoRouterMock())
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }))
const mockSignUp = jest.fn()
jest.mock('@/features/auth/actions', () => ({
  ...jest.requireActual('@/features/auth/actions'),
  signUpStudent: (...a: unknown[]) => mockSignUp(...a),
}))
jest.mock('@/features/auth/human-check', () => ({ useHumanCheck: () => jest.fn() }))

beforeEach(() => {
  resetRouter()
  mockSignUp.mockReset()
})

describe('main path: sign up → verify email → sign in', () => {
  it('walks through the screens by testID', async () => {
    await renderScreen(<Welcome />)
    await fireEvent.press(screen.getByTestId('welcome-sign-up'))
    expect(mockRouter.push).toHaveBeenCalledWith('/sign-up')

    mockSignUp.mockResolvedValue({})
    await renderScreen(<SignUp />)
    expect(screen.getByTestId('sign-up-submit')).toBeDisabled()
    await fireEvent.changeText(screen.getByTestId('sign-up-name'), 'E2E 同学')
    await fireEvent.changeText(screen.getByTestId('sign-up-email'), ' new@example.test ')
    await fireEvent.changeText(screen.getByTestId('sign-up-password'), 'synthetic-pass-123')
    await fireEvent.press(screen.getByTestId('sign-up-terms'))
    expect(screen.getByTestId('sign-up-submit')).toBeDisabled()
    await fireEvent.press(screen.getByTestId('sign-up-privacy'))
    await fireEvent.press(screen.getByTestId('sign-up-submit'))
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/check-email', params: { email: 'new@example.test' } }))
    expect(mockSignUp.mock.calls[0][1]).toMatchObject({ name: 'E2E 同学', email: 'new@example.test', agreeTerms: true, agreePrivacy: true, joinTalentPool: false })

    routeParams.current = { email: 'new@example.test' }
    await renderScreen(<CheckEmail />)
    expect(screen.getByText(/new@example\.test/)).toBeOnTheScreen()
    await fireEvent.press(screen.getByTestId('check-email-sign-in'))
    expect(mockRouter.replace).toHaveBeenLastCalledWith('/sign-in')
  })

  it('shows a mapped error when the server rejects the sign-up', async () => {
    mockSignUp.mockRejectedValue(Object.assign(new Error('SIGNUP_CLOSED'), { code: 'SIGNUP_CLOSED' }))
    await renderScreen(<SignUp />)
    await fireEvent.changeText(screen.getByTestId('sign-up-name'), 'E2E')
    await fireEvent.changeText(screen.getByTestId('sign-up-email'), 'new@example.test')
    await fireEvent.changeText(screen.getByTestId('sign-up-password'), 'synthetic-pass-123')
    await fireEvent.press(screen.getByTestId('sign-up-terms'))
    await fireEvent.press(screen.getByTestId('sign-up-privacy'))
    await fireEvent.press(screen.getByTestId('sign-up-submit'))
    expect(await screen.findByText(/注册名额/)).toBeOnTheScreen()
    expect(mockRouter.replace).not.toHaveBeenCalled()
  })
})
