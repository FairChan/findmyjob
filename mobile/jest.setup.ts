// better-auth 的客户端只发 ESM，单测里不需要真的会话：默认换成一个桩，个别测试可以自己再 jest.mock 覆盖
jest.mock('@/lib/auth-client', () => ({
  AUTH_STORAGE_PREFIX: 'findmyjob',
  appOrigin: () => 'findmyjob-dev://',
  sessionCookie: async () => '',
  clearLocalSession: async () => {},
  authClient: {
    useSession: () => ({ data: null, isPending: false }),
    getSession: async () => ({ data: null }),
    signOut: async () => ({}),
  },
}))

// 原生模块在 Jest 里不存在：AsyncStorage 用官方 mock；推送用一个只记录调用的桩
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock 工厂里只能用 require
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'))
jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ status: 'undetermined' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  getDevicePushTokenAsync: jest.fn(async () => ({ type: 'android', data: 'fcm-test-token' })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}))
