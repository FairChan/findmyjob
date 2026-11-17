import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

import { MESSAGES } from '@/i18n/messages'

// use-intl 在这个工程里没有按 messages 做类型约束，写错 key 只会在运行时显示成 key 路径。
// 这里静态扫一遍 app/ 和 src/：`const t = useTranslations('ns')` 之后的 t('literal') 必须在中英两份里都存在。
const ROOT = join(__dirname, '..')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return files(p)
    return /\.tsx?$/.test(name) ? [p] : []
  })
}

function lookup(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj)
}

describe('translation keys used in code exist', () => {
  const used: { file: string; key: string }[] = []
  for (const file of [...files(join(ROOT, 'app')), ...files(join(ROOT, 'src'))]) {
    const src = readFileSync(file, 'utf8')
    // 同一个文件里不同组件会把 t 绑到不同命名空间：每个绑定只管到下一个同名绑定为止（组件在文件里是顺序排列的）
    const bindings = [...src.matchAll(/const (\w+) = useTranslations\('([\w.]+)'\)/g)].map((m) => ({ name: m[1]!, ns: m[2]!, at: m.index! }))
    for (const b of bindings) {
      const end = bindings.find((o) => o.name === b.name && o.at > b.at)?.at ?? src.length
      const region = src.slice(b.at, end)
      for (const call of region.matchAll(new RegExp(String.raw`\b${b.name}\('([\w.]+)'`, 'g'))) used.push({ file: file.slice(ROOT.length + 1), key: `${b.ns}.${call[1]}` })
    }
  }

  it('finds usages', () => expect(used.length).toBeGreaterThan(50))

  it.each(['zh', 'en'] as const)('all literal keys resolve in %s', (locale) => {
    const missing = used.filter((u) => typeof lookup(MESSAGES[locale], u.key) !== 'string').map((u) => `${u.file}: ${u.key}`)
    expect([...new Set(missing)]).toEqual([])
  })
})
