import { mobileApiUrl } from '@/lib/api-config'

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '0.1.0', extra: { apiBaseUrl: 'https://findmyjob.asia/' } } },
}))

it('joins base url, prefix and path', () => {
  expect(mobileApiUrl('/me')).toBe('https://findmyjob.asia/api/m/v1/me')
  expect(mobileApiUrl('jobs')).toBe('https://findmyjob.asia/api/m/v1/jobs')
})
