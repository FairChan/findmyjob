import { readFileSync } from 'fs'
import { join } from 'path'

import { COMMON_INDUSTRIES, MY_STATES } from '@/lib/reference-data'

// App 抄了 Web 的两张字典（App 不能 import src/lib）；这里直接读 Web 源文件对照，防止漂移
const web = (file: string) => readFileSync(join(__dirname, '..', '..', 'src', 'lib', file), 'utf8')

function entries(src: string, block: string, zhKey: string, enKey: string) {
  // 从 "= [" 开始截到行首的 "]"：类型注解里的 [] 不算
  const start = src.indexOf('= [', src.indexOf(block))
  const body = src.slice(start, src.indexOf('\n]', start))
  const re = new RegExp(`code: '([^']+)', ${zhKey}: '([^']+)', ${enKey}: '([^']+)'`, 'g')
  return [...body.matchAll(re)].map((m) => ({ code: m[1], zh: m[2], en: m[3] }))
}

describe('reference data mirrors the web', () => {
  it('states match src/lib/my-states.ts', () => {
    expect(MY_STATES.map((s) => ({ ...s }))).toEqual(entries(web('my-states.ts'), 'MY_STATES', 'labelZh', 'labelEn'))
  })

  it('industries match src/lib/malaysia.ts', () => {
    expect(COMMON_INDUSTRIES.map((s) => ({ ...s }))).toEqual(entries(web('malaysia.ts'), 'COMMON_INDUSTRIES', 'nameZh', 'nameEn'))
  })
})
