/**
 * apply.js — load test for the job application endpoint.
 *
 * Prerequisites:
 *   APP_ENV=staging npx tsx prisma/seed-load.ts
 *
 * Run (Git Bash):
 *   docker run --rm -i \
 *     -e BASE_URL=http://host.docker.internal:3001 \
 *     -v "$(pwd -W)/load":/load \
 *     grafana/k6:latest run /load/k6/apply.js
 *
 * NOTE: The /api/s/jobs/:jobId/apply endpoint is planned for a future milestone.
 * Until it is implemented this script will return 404 for all requests; that is expected.
 * 409 responses indicate a duplicate application attempt and are treated as success.
 */
import http from 'k6/http'
import { check, sleep } from 'k6'
import { SharedArray } from 'k6/data'
import { fail } from 'k6'

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001'

const students = new SharedArray('students', function () {
  return JSON.parse(open('../../load/students.local.json'))
})
const jobs = new SharedArray('jobs', function () {
  return JSON.parse(open('../../load/jobs.local.json'))
})

export function setup() {
  if (students.length === 0) fail('Need students — run: APP_ENV=staging npx tsx prisma/seed-load.ts')
  if (jobs.length === 0) fail('Need jobs — run: APP_ENV=staging npx tsx prisma/seed-load.ts')
}

export const options = {
  scenarios: {
    job_apply: {
      executor: 'constant-vus',
      vus: 20,
      duration: '2m',
    },
  },
  thresholds: {
    'http_req_duration{name:job_apply}': ['p(95)<1000'],
    // 409 (duplicate apply) is expected and not a failure
    'http_req_failed': ['rate<0.05'],
  },
}

export default function jobApply() {
  const student = students[(__VU - 1) % students.length]
  // Spread students across jobs to distribute load; some 409s expected for repeat pairs
  const job = jobs[(__VU - 1 + Math.floor(Math.random() * jobs.length)) % jobs.length]

  const res = http.post(
    `${BASE_URL}/api/s/jobs/${job.jobId}/apply`,
    JSON.stringify({ coverNote: '' }),
    {
      headers: {
        'Content-Type': 'application/json',
        Cookie: student.cookie,
      },
      tags: { name: 'job_apply' },
    },
  )
  check(res, {
    // 201 = applied, 409 = already applied (both correct outcomes)
    'apply 201 or 409': (r) => r.status === 201 || r.status === 409,
  })
  sleep(0.5 + Math.random() * 0.5)
}
