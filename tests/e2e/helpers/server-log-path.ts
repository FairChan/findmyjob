import { join } from 'path'
import { tmpdir } from 'os'

/**
 * Temp file where the E2E dev server writes its stdout+stderr. Keyed by port so that two
 * checkouts running E2E at the same time (main on 3000, lane B on 3001) never truncate or
 * read each other's log.
 */
export const SERVER_LOG_PATH = join(tmpdir(), `findmyjob-e2e-server-${Number(process.env.PORT) || 3000}.log`)

/** PII sentinel values from pii-leak.spec.ts that must never appear in server logs. */
export const PII_SENTINELS = [
  '哨兵测试同学甲',
  '+60 12-000 0420',
  '+601200000420',
  '601200000420',
  'leak-sentinel@example.test',
  '+60 11-000 0421',
  'pii-m4t13-wechat-sentinel',
  'resumes/pii-m4t13-sentinel/cv.pdf',
  'https://www.linkedin.com/in/pii-m4t13-sentinel',
]
