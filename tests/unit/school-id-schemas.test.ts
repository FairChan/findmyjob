import { describe, it, expect, vi } from 'vitest'

// 只测 schema：service 模块顶层会引入 db 和 env，这里换成空实现，不连数据库
vi.mock('@/env', () => ({ env: {} }))
vi.mock('@/server/db', () => ({ db: {} }))

const { requestOtpSchema } = await import('@/server/services/school-verification')
const { searchFiltersSchema } = await import('@/server/services/talent-search')

// 种子数据里的学校 id 是 school-xmum 这种可读字符串，不是 cuid（M2-T11 复查）。
// 这两处曾经用 z.string().cuid()，试点学校 XMUM 的学校邮箱认证和人才库学校筛选都会被拒
describe('schoolId accepts seeded, non-cuid ids', () => {
  it('requestOtpSchema accepts school-xmum', () => {
    const r = requestOtpSchema.safeParse({ schoolId: 'school-xmum', schoolEmail: 'a@xmu.edu.my' })
    expect(r.success).toBe(true)
  })

  it('searchFiltersSchema accepts school-xmum', () => {
    const r = searchFiltersSchema.safeParse({ page: 1, schoolId: 'school-xmum' })
    expect(r.success).toBe(true)
  })

  it('both still reject an empty or over-long schoolId', () => {
    expect(requestOtpSchema.safeParse({ schoolId: '', schoolEmail: 'a@xmu.edu.my' }).success).toBe(false)
    expect(searchFiltersSchema.safeParse({ page: 1, schoolId: 'x'.repeat(65) }).success).toBe(false)
  })
})
