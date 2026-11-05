/**
 * Smoke test — the ONLY script allowed to run against production.
 * 1 VU, 1 minute, public pages + /api/health only.
 */
import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = {
  vus: 1,
  duration: '1m',
  thresholds: {
    'http_req_duration': ['p(95)<800'],
    'http_req_failed': ['rate<0.01'],
  },
}

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'

const PUBLIC_PATHS = [
  '/api/health',
  '/zh',
  '/en',
  '/zh/jobs',
  '/en/jobs',
]

export default function smokeTest() {
  for (const path of PUBLIC_PATHS) {
    const res = http.get(`${BASE_URL}${path}`, {
      headers: { Accept: 'text/html,application/xhtml+xml,application/json' },
      tags: { name: path },
    })
    check(res, {
      [`${path} < 400`]: (r) => r.status < 400,
    })
    sleep(1)
  }
}
