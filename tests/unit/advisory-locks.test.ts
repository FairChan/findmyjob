import { describe, it, expect, vi } from 'vitest'

// advisory-locks.ts 顶部引入了 server-only；这里只读常量，不连数据库
vi.mock('server-only', () => ({}))

const { LOCK_NS } = await import('@/server/lib/advisory-locks')

// 两条开发线各自加命名空间时撞过号（MANAGED_TRANSFER 和 CREDIT 都是 1003），
// 撞号会让两种锁共用同一个键、互相串行。合并时靠这条测试直接报红。
describe('LOCK_NS', () => {
  const entries = Object.entries(LOCK_NS) as Array<[string, number]>

  it('has at least the namespaces in use', () => {
    expect(entries.map(([k]) => k)).toEqual(
      expect.arrayContaining(['JOB_VIEW_QUOTA', 'PROFILE_VIEW', 'CREDIT', 'MANAGED_TRANSFER', 'APPLICATION']),
    )
  })

  it('every value is an integer', () => {
    const nonIntegers = entries.filter(([, v]) => !Number.isInteger(v))
    expect(nonIntegers).toEqual([])
  })

  it('values are pairwise distinct', () => {
    const seen = new Map<number, string>()
    const duplicates: string[] = []
    for (const [name, value] of entries) {
      const prev = seen.get(value)
      if (prev) duplicates.push(`${prev} and ${name} both use ${value}`)
      else seen.set(value, name)
    }
    expect(duplicates).toEqual([])
  })
})
