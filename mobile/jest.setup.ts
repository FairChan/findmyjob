// better-auth 的客户端只发 ESM，单测里不需要真的会话：默认换成一个桩，个别测试可以自己再 jest.mock 覆盖
jest.mock('@/lib/auth-client', () => ({
  AUTH_STORAGE_PREFIX: 'findmyjob',
  appOrigin: () => 'findmyjob-dev://',
  sessionCookie: async () => '',
  authClient: {
    useSession: () => ({ data: null, isPending: false }),
    getSession: async () => ({ data: null }),
    signOut: async () => ({}),
  },
}))
