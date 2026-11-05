import http from 'k6/http'
import { sleep, check, fail } from 'k6'
import { SharedArray } from 'k6/data'

// E2 pilot capacity = 200; ramp to 1.2x
const E2_VUSERS = Math.ceil(200 * 1.2) // 240

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'

// Pre-generated employer sessions from prisma/seed-load.ts (staging only)
const accounts = new SharedArray('accounts', function () {
  return JSON.parse(open('../../load/accounts.local.json'))
})

const LOCALES = ['zh', 'en']
const SEARCH_TERMS = ['软件', '财务', '市场', '运营', '销售', 'intern', 'finance', 'marketing', 'IT']

export function setup() {
  if (accounts.length === 0) {
    fail('accounts file is empty — run prisma/seed-load.ts (APP_ENV=staging) first')
  }
}

export const options = {
  scenarios: {
    job_browse: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: E2_VUSERS },
        { duration: '5m', target: E2_VUSERS },
        { duration: '2m', target: 0 },
      ],
      exec: 'jobBrowse',
      gracefulRampDown: '30s',
    },
    talent_search: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: E2_VUSERS },
        { duration: '5m', target: E2_VUSERS },
        { duration: '2m', target: 0 },
      ],
      exec: 'talentSearch',
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    'http_req_duration': ['p(95)<800'],
    'http_req_failed': ['rate<0.01'],
  },
}

export function jobBrowse() {
  const locale = LOCALES[__VU % LOCALES.length]
  const headers = { Accept: 'text/html,application/xhtml+xml' }

  // Job listing
  const listRes = http.get(`${BASE_URL}/${locale}/jobs`, { headers, tags: { name: 'job_list' } })
  check(listRes, { 'job list 200': (r) => r.status === 200 })
  sleep(0.5 + Math.random())

  const term = SEARCH_TERMS[Math.floor(Math.random() * SEARCH_TERMS.length)]

  // EXACT search
  const exactRes = http.get(
    `${BASE_URL}/${locale}/jobs?q=${encodeURIComponent(term)}&mode=EXACT`,
    { headers, tags: { name: 'job_search_exact' } },
  )
  check(exactRes, { 'exact search ok': (r) => r.status === 200 })
  sleep(0.5 + Math.random())

  // RELATED search
  const relatedRes = http.get(
    `${BASE_URL}/${locale}/jobs?q=${encodeURIComponent(term)}&mode=RELATED`,
    { headers, tags: { name: 'job_search_related' } },
  )
  check(relatedRes, { 'related search ok': (r) => r.status === 200 })
  sleep(1 + Math.random())
}

export function talentSearch() {
  const account = accounts[__VU % accounts.length]
  const locale = LOCALES[__VU % LOCALES.length]
  const term = SEARCH_TERMS[Math.floor(Math.random() * SEARCH_TERMS.length)]

  const res = http.get(
    `${BASE_URL}/${locale}/e/talent?q=${encodeURIComponent(term)}`,
    {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        Cookie: account.cookie,
      },
      redirects: 0,
      tags: { name: 'talent_search' },
    },
  )
  check(res, { 'talent search ok': (r) => r.status === 200 })
  sleep(1 + Math.random())
}
