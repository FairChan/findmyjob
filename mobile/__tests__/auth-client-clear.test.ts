import * as SecureStore from 'expo-secure-store'

// 测真实的 auth-client（jest.setup.ts 全局把它换成了桩）；better-auth 客户端本身只发 .mjs，换成最小桩
jest.unmock('@/lib/auth-client')
const mockNotify = jest.fn()
jest.mock('better-auth/react', () => ({ createAuthClient: () => ({ $store: { notify: mockNotify }, getCookie: () => '' }) }))
jest.mock('@better-auth/expo/client', () => ({ expoClient: () => ({ id: 'expo' }) }))
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>()
  return {
    __store: store,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
  }
})
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '0.1.0', scheme: 'findmyjob-dev', extra: { apiBaseUrl: 'http://api.test' } } } }))

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store

describe('clearLocalSession', () => {
  it('deletes the cookie and session cache keys, including split chunks', async () => {
    const { clearLocalSession } = jest.requireActual('@/lib/auth-client') as typeof import('@/lib/auth-client')
    store.set('findmyjob_cookie', 'ba-chunks:2:1:1')
    store.set('findmyjob_cookie.1.0', 'part-a')
    store.set('findmyjob_cookie.1.1', 'part-b')
    store.set('findmyjob_cookie.0.0', 'old')
    store.set('findmyjob_session_data', '{"user":{"id":"u1"}}')
    store.set('findmyjob.pref.locale', 'zh')
    await clearLocalSession()
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('findmyjob_cookie')
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('findmyjob_session_data')
    expect([...store.keys()]).toEqual(['findmyjob.pref.locale'])
    expect(mockNotify).toHaveBeenCalledWith('$sessionSignal')
  })
})
