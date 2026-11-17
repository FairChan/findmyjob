import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

// 本机没有 Android SDK，Maestro 流程跑不起来（MA2-T10 部分完成）。至少守住一点：
// 流程里引用的每个 id 都真的写在页面源码里，改名或删掉 testID 时这里先失败。
const ROOT = join(__dirname, '..')
const MAESTRO = join(ROOT, '.maestro')

function files(dir: string, re: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? files(p, re) : re.test(name) ? [p] : []
  })
}

const source = [...files(join(ROOT, 'app'), /\.tsx$/), ...files(join(ROOT, 'src'), /\.tsx?$/)].map((f) => readFileSync(f, 'utf8')).join('\n')

/** 源码里出现过的 testID：字面量，或模板串的固定前缀（如 `job-card-${id}` → job-card-） */
const literal = new Set([...source.matchAll(/(?:testID|tabBarButtonTestID|testIDPrefix)[=:]\s*\{?\s*['"]([\w-]+)['"]/g)].map((m) => m[1]!))
const prefixes = [...source.matchAll(/testID=\{`([\w-]+)\$\{/g)].map((m) => m[1]!)
// testIDPrefix 会拼成 `${prefix}-${value}`
const groupPrefixes = [...source.matchAll(/testIDPrefix="([\w-]+)"/g)].map((m) => `${m[1]}-`)

function exists(id: string): boolean {
  if (literal.has(id)) return true
  const prefix = id.endsWith('.*') ? id.slice(0, -2) : null
  if (prefix) return [...prefixes, ...groupPrefixes].includes(prefix)
  return [...prefixes, ...groupPrefixes].some((p) => id.startsWith(p))
}

const flows = files(MAESTRO, /\.yaml$/).filter((f) => !f.endsWith('config.yaml'))

describe('maestro flows', () => {
  it('has the six main paths', () => {
    const top = readdirSync(MAESTRO).filter((n) => /^\d\d-.*\.yaml$/.test(n))
    expect(top).toHaveLength(6)
  })

  it.each(flows.map((f) => [f.slice(MAESTRO.length + 1), f]))('%s only references testIDs that exist', (_name, file) => {
    const ids = [...readFileSync(file, 'utf8').matchAll(/id: "([^"]+)"/g)].map((m) => m[1]!)
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.filter((id) => !exists(id))).toEqual([])
  })
})
