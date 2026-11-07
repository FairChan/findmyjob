import { join } from 'path'
import { tmpdir } from 'os'

/** Temp file where the E2E dev server writes its stdout+stderr. */
export const SERVER_LOG_PATH = join(tmpdir(), 'findmyjob-laneb-e2e-server.log')

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
