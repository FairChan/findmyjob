import { signOut } from '@/features/auth/actions'

// 安全评审：服务端 /sign-out 失败（离线、5xx、会话已吊销）时也必须清掉本机凭据（fail-closed）
const mockServerSignOut = jest.fn()
const mockClearLocalSession = jest.fn(async () => {})
jest.mock('@/lib/auth-client', () => ({
  AUTH_STORAGE_PREFIX: 'findmyjob',
  appOrigin: () => 'findmyjob-dev://',
  sessionCookie: async () => '',
  clearLocalSession: () => mockClearLocalSession(),
  authClient: { signOut: () => mockServerSignOut() },
}))

beforeEach(() => {
  mockServerSignOut.mockReset()
  mockClearLocalSession.mockClear()
})

describe('signOut', () => {
  it('clears local credentials after a successful server sign-out', async () => {
    mockServerSignOut.mockResolvedValue({})
    await signOut()
    expect(mockClearLocalSession).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['network failure', () => Promise.reject(new TypeError('Network request failed'))],
    ['server error', () => Promise.reject(Object.assign(new Error('500'), { status: 500 }))],
  ])('still clears local credentials on %s and does not throw', async (_name, impl) => {
    mockServerSignOut.mockImplementation(impl)
    await expect(signOut()).resolves.toBeUndefined()
    expect(mockClearLocalSession).toHaveBeenCalledTimes(1)
  })
})
