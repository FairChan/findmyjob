import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'

import { registerDeviceIfPermitted, requestPermissionAndRegister, revokeThisDevice, safePushRoute, shouldOfferPushPrompt } from '@/features/push/push'
import { apiFetch } from '@/lib/api-client'
import { clearPersistedQueries, PERSIST_STORAGE_KEY, shouldPersistQuery } from '@/lib/query-persist'

jest.mock('@/lib/api-client', () => ({ apiFetch: jest.fn() }))
jest.mock('@/lib/api-config', () => ({ appVersion: () => '0.1.0' }))
const mockStore = new Map<string, string>()
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}))

const mockedFetch = apiFetch as jest.Mock
beforeEach(() => {
  mockStore.clear()
  mockedFetch.mockReset()
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ status: 'undetermined' } as never)
})

describe('push routing', () => {
  it('only follows whitelisted in-app routes from push data', () => {
    expect(safePushRoute('/applications')).toBe('/applications')
    expect(safePushRoute('/applications?tab=invitations')).toBe('/applications?tab=invitations')
    expect(safePushRoute('/notifications')).toBe('/notifications')
    expect(safePushRoute('/delete-account')).toBe('/')
    expect(safePushRoute('https://evil.example')).toBe('/')
    expect(safePushRoute(undefined)).toBe('/')
  })
})

describe('device registration', () => {
  it('offers the in-app prompt only once and only while undetermined', async () => {
    expect(await shouldOfferPushPrompt()).toBe(true)
    await SecureStore.setItemAsync('findmyjob_push_prompted', '1')
    expect(await shouldOfferPushPrompt()).toBe(false)
  })

  it('does nothing until notifications are permitted', async () => {
    expect(await registerDeviceIfPermitted('zh')).toBeNull()
    expect(mockedFetch).not.toHaveBeenCalled()
  })

  it('registers the native FCM token and remembers the device id; sign-out revokes it', async () => {
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ status: 'granted' } as never)
    mockedFetch.mockResolvedValueOnce({ id: 'cdevice000000000000000001' })
    expect(await registerDeviceIfPermitted('en')).toBe('cdevice000000000000000001')
    expect(mockedFetch).toHaveBeenCalledWith('/devices', expect.objectContaining({ method: 'POST', body: { token: 'fcm-test-token', appVersion: '0.1.0', locale: 'en' } }))
    mockedFetch.mockResolvedValueOnce({})
    await revokeThisDevice()
    expect(mockedFetch).toHaveBeenLastCalledWith('/devices/cdevice000000000000000001', { method: 'DELETE' })
    expect(mockStore.size).toBe(0)
  })

  it('a phone without Google services is reported as unsupported, not an error', async () => {
    jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValueOnce({ status: 'granted' } as never)
    jest.mocked(Notifications.getPermissionsAsync).mockResolvedValue({ status: 'granted' } as never)
    jest.mocked(Notifications.getDevicePushTokenAsync).mockRejectedValueOnce(new Error('no GMS'))
    expect(await requestPermissionAndRegister('zh')).toBe('unsupported')
    expect(mockedFetch).not.toHaveBeenCalled()
  })

})

describe('offline cache whitelist', () => {
  const q = (key: unknown[], status = 'success') => ({ queryKey: key, state: { status } }) as never
  it('persists public / low-sensitivity lists only', () => {
    for (const key of [['jobs', {}], ['jobs', 'preview', 'x'], ['companies', null], ['company', 'x'], ['applications'], ['invitations'], ['notifications']]) {
      expect(shouldPersistQuery(q(key))).toBe(true)
    }
    for (const key of [['me'], ['profile'], ['profile', 'completeness'], ['privacy'], ['resumes'], ['referrals'], ['jobOpen', 'x'], ['schools']]) {
      expect(shouldPersistQuery(q(key))).toBe(false)
    }
    expect(shouldPersistQuery(q(['jobs', {}], 'error'))).toBe(false)
  })

  it('clears the on-disk cache', async () => {
    await AsyncStorage.setItem(PERSIST_STORAGE_KEY, '{}')
    await clearPersistedQueries()
    expect(await AsyncStorage.getItem(PERSIST_STORAGE_KEY)).toBeNull()
  })
})
