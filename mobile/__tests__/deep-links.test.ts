import { APP_LINK_PATH_PREFIXES as CONFIG_PREFIXES } from '../app.config'
import { APP_LINK_PATH_PREFIXES, mapIncomingPath } from '@/lib/deep-links'
import { redirectSystemPath } from '../app/+native-intent'

describe('mapIncomingPath', () => {
  it.each([
    ['https://findmyjob.asia/zh/s/jobs/cjob00000000000000000001', '/jobs/cjob00000000000000000001'],
    ['https://findmyjob.asia/en/jobs/cjob00000000000000000001', '/jobs/cjob00000000000000000001'],
    ['/zh/s/applications', '/applications'],
    ['/en/s/invitations', '/applications?tab=invitations'],
    ['/zh/companies/ccompany000000000000001', '/companies/ccompany000000000000001'],
    ['/zh/s', '/home'],
    ['/applications?tab=invitations', '/applications?tab=invitations'],
    ['findmyjob://jobs/abc', '/jobs/abc'],
  ])('%s → %s', (input, expected) => {
    expect(mapIncomingPath(input)).toBe(expected)
  })

  it.each([
    'https://findmyjob.asia/api/auth/verify-email?token=secret',
    '/zh/reset-password?token=secret',
    '/zh/admin',
    '/zh/e/talent/x',
    '/delete-account',
    '/settings',
    'javascript:alert(1)',
    '/zh/s/jobs/../../admin',
    '/zh/s/privacy/exports/cexport0000000000000001',
  ])('sends %s to the gate', (input) => {
    expect(mapIncomingPath(input)).toBe('/')
  })

  it('is what expo-router calls', () => {
    expect(redirectSystemPath({ path: '/zh/s/jobs/abc', initial: true })).toBe('/jobs/abc')
  })
})

describe('app.config intent filters', () => {
  it('claim exactly the web paths the router can map', () => {
    expect(CONFIG_PREFIXES).toEqual([...APP_LINK_PATH_PREFIXES])
  })
})
