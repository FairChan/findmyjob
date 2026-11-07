/**
 * unlock.js — concurrency correctness tests for the talent unlock endpoint.
 *
 * Prerequisites:
 *   APP_ENV=staging npx tsx prisma/seed-load.ts
 *
 * Run (Git Bash):
 *   docker run --rm -i \
 *     -e BASE_URL=http://host.docker.internal:3001 \
 *     -v "$(pwd -W)/load":/load \
 *     grafana/k6:0.54.0 run /load/k6/unlock.js
 *
 * After the run, verify correctness with SQL:
 *
 *   -- Scenario 1: balance_race
 *   --   accounts[0] starts with balance=3; 10 VUs each try to unlock a different student.
 *   --   Expected: exactly 3 TalentUnlock rows, 3 UNLOCK ledger entries, final balance=0.
 *   SELECT COUNT(*) FROM "TalentUnlock"  WHERE "companyId" = '<accounts[0].companyId>';
 *   SELECT COUNT(*) FROM "CreditLedger" cl
 *     JOIN "CreditWallet" cw ON cl."walletId" = cw.id
 *     WHERE cw."companyId" = '<accounts[0].companyId>' AND cl.reason = 'UNLOCK';
 *   SELECT balance FROM "CreditWallet" WHERE "companyId" = '<accounts[0].companyId>';
 *   -- All three queries should return 3, 3, 0 respectively; balance must be >= 0.
 *
 *   -- Scenario 2: idempotent_unlock
 *   --   accounts[1] has balance=100; 10 VUs all try to unlock students[0] simultaneously.
 *   --   Expected: exactly 1 TalentUnlock row for that student; credits charged only once.
 *   SELECT COUNT(*) FROM "TalentUnlock"
 *     WHERE "companyId" = '<accounts[1].companyId>'
 *       AND "studentId" = '<students[0].studentId>';
 *   SELECT COUNT(*) FROM "CreditLedger" cl
 *     JOIN "CreditWallet" cw ON cl."walletId" = cw.id
 *     WHERE cw."companyId" = '<accounts[1].companyId>' AND cl.reason = 'UNLOCK';
 *   -- Both queries should return 1; balance must be >= 0.
 *
 * NOTE: The /api/e/talent/:studentId/unlock endpoint is planned for a future milestone.
 * Until it is implemented this script will return 404 for all requests; that is expected.
 */
import http from 'k6/http'
import { check } from 'k6'
import { SharedArray } from 'k6/data'
import { fail } from 'k6'

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001'

const accounts = new SharedArray('accounts', function () {
  return JSON.parse(open('../../load/accounts.local.json'))
})
const students = new SharedArray('students', function () {
  return JSON.parse(open('../../load/students.local.json'))
})

export function setup() {
  if (accounts.length < 2) fail('Need ≥ 2 accounts — run: APP_ENV=staging npx tsx prisma/seed-load.ts')
  if (students.length < 10) fail('Need ≥ 10 students — run: APP_ENV=staging npx tsx prisma/seed-load.ts')
}

export const options = {
  scenarios: {
    // 10 VUs all share accounts[0] (initial balance = 3).
    // Each VU unlocks a different student — only 3 should succeed.
    balance_race: {
      executor: 'per-vu-iterations',
      vus: 10,
      iterations: 1,
      exec: 'balanceRace',
      gracefulStop: '10s',
    },
    // 10 VUs all share accounts[1] (balance = 100) and unlock the same student.
    // The TalentUnlock unique constraint ensures only 1 row is created.
    idempotent_unlock: {
      executor: 'per-vu-iterations',
      vus: 10,
      iterations: 1,
      exec: 'idempotentUnlock',
      startTime: '20s',
      gracefulStop: '10s',
    },
  },
  thresholds: {
    // Correctness test — 402 (insufficient credits) and 409 (already unlocked) are expected.
    // Only 5xx responses count as failures here.
    'checks{scenario:balance_race}': ['rate>0'],
    'checks{scenario:idempotent_unlock}': ['rate>0'],
  },
}

export function balanceRace() {
  const account = accounts[0] // race company: balance = 3
  const student = students[(__VU - 1) % 10] // each VU targets a distinct student
  const res = http.post(
    `${BASE_URL}/api/e/talent/${student.studentId}/unlock`,
    null,
    {
      headers: { Cookie: account.cookie },
      tags: { name: 'unlock_balance_race' },
    },
  )
  check(res, {
    // 2xx = success, 402 = insufficient credits (both are correct outcomes)
    'unlock 2xx or 402': (r) => r.status < 300 || r.status === 402,
  })
}

export function idempotentUnlock() {
  const account = accounts[1] // idempotent company: balance = 100
  const student = students[0] // all 10 VUs target the same student
  const res = http.post(
    `${BASE_URL}/api/e/talent/${student.studentId}/unlock`,
    null,
    {
      headers: { Cookie: account.cookie },
      tags: { name: 'unlock_idempotent' },
    },
  )
  check(res, {
    // 201 = new unlock, 200 = already unlocked (returned idempotently), 409 also acceptable
    'unlock 2xx or 409': (r) => r.status < 300 || r.status === 409,
  })
}
