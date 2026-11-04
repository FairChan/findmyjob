import { describe, it, expect } from 'vitest'
import { toStandardRow } from './standard-resume'
import { parseBands } from './settings'
import { fullStudent } from '../test/fixtures'
import type { Experience } from '../data/mock'

const exp = (kind: Experience['kind']): Experience => ({ id: kind + Math.round(kind.length), kind, title: kind, org: '', period: '', desc: '' })

describe('toStandardRow', () => {
  it('summarises experiences and formats cgpa', () => {
    const s = fullStudent({ fullName: '林雨晴', cgpa: 3.6, gradYear: 2026, gradMonth: 6, experiences: [exp('实习'), exp('实习'), exp('校园'), exp('项目')] })
    expect(toStandardRow(s, { masked: true })).toMatchObject({ name: '林同学', cgpa: '3.60', grad: '2026-06', internships: 2, campus: 1 })
    expect(toStandardRow(fullStudent({ cgpa: undefined }), { masked: false }).cgpa).toBe('—')
  })
  it('lists at most two languages', () => {
    const s = fullStudent({ languages: [{ lang: '中文', level: 'NATIVE' }, { lang: '英文', level: 'FLUENT' }, { lang: '马来文', level: 'BASIC' }] })
    expect(toStandardRow(s, { masked: false }).languages).toBe('中文、英文')
  })
})

describe('parseBands', () => {
  it('normalises and rejects bad input', () => {
    expect(parseBands('3000, 2000 5000')).toEqual([2000, 3000, 5000])
    expect(parseBands('3000,3000')).toEqual([3000])
    expect(parseBands('')).toBeNull()
    expect(parseBands('3000,abc')).toBeNull()
    expect(parseBands('-1')).toBeNull()
  })
})
