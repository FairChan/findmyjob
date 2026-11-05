import { describe, it, expect } from 'vitest'
import { redact, REDACTED } from '@/lib/redact'

const R = REDACTED

describe('redact – emails', () => {
  it('replaces a plain email address', () => {
    expect(redact('联系 user@example.com 获取详情')).toBe(`联系 ${R} 获取详情`)
  })

  it('replaces email with subdomain', () => {
    expect(redact('Send to alice.b+tag@mail.example.org please')).toBe(
      `Send to ${R} please`,
    )
  })
})

describe('redact – Malaysian phones', () => {
  it('replaces +60 country-code number with hyphen', () => {
    expect(redact('+60 12-345 6789')).toBe(R)
  })

  it('replaces +60 country-code number without separators', () => {
    expect(redact('call +60123456789 now')).toBe(`call ${R} now`)
  })

  it('replaces local 01x number with hyphen separator', () => {
    expect(redact('012-3456789 是我的号码')).toBe(`${R} 是我的号码`)
  })

  it('replaces sentinel phone value from factories', () => {
    // Factories sentinel: +60 12-000 0420
    expect(redact('哨兵电话 +60 12-000 0420 结束')).toBe(`哨兵电话 ${R} 结束`)
  })

  it('replaces phone embedded in Chinese text', () => {
    expect(redact('我的手机是 +60 11-1234 5678，请联系我')).toBe(
      `我的手机是 ${R}，请联系我`,
    )
  })
})

describe('redact – Chinese phones', () => {
  it('replaces +86 Chinese mobile with spaces', () => {
    expect(redact('+86 139 1234 5678')).toBe(R)
  })

  it('replaces +86 Chinese mobile without spaces', () => {
    expect(redact('微信/+8613912345678')).toBe(`微信/${R}`)
  })
})

describe('redact – WeChat patterns', () => {
  it('replaces 微信：<id>', () => {
    expect(redact('微信：abc123')).toBe(R)
  })

  it('replaces WeChat: <id>', () => {
    expect(redact('Contact me WeChat: myid_2024')).toBe(`Contact me ${R}`)
  })

  it('replaces wx <id> (word-bounded)', () => {
    expect(redact('wx leakwx0420')).toBe(R)
  })

  it('replaces 微信 without colon separator', () => {
    expect(redact('加我微信 wechat123')).toBe(`加我${R}`)
  })
})

describe('redact – URLs', () => {
  it('replaces https URL', () => {
    expect(redact('profile: https://linkedin.com/in/alice')).toBe(`profile: ${R}`)
  })

  it('replaces http URL', () => {
    expect(redact('查看 http://example.com/cv')).toBe(`查看 ${R}`)
  })
})

describe('redact – full-width characters', () => {
  it('replaces full-width digit phone number', () => {
    // Full-width: ＋６０ １２－３４５ ６７８９
    const fw = '＋６０ １２－３４５ ６７８９'
    const result = redact(fw)
    expect(result).toBe(R)
  })

  it('replaces email with full-width at-sign area (normalized)', () => {
    // ｕｓｅｒ＠ｅｘａｍｐｌｅ．ｃｏｍ normalises to user@example.com
    const fw = 'ｕｓｅｒ＠ｅｘａｍｐｌｅ．ｃｏｍ'
    expect(redact(fw)).toBe(R)
  })
})

describe('redact – mixed Chinese/English', () => {
  it('redacts multiple PII types in one string', () => {
    const input = '邮箱 user@test.com，电话 +60 12-345 6789，微信 wx_abc'
    const result = redact(input)
    // WeChat keyword + account are redacted as one unit
    expect(result).toBe(`邮箱 ${R}，电话 ${R}，${R}`)
  })

  it('redacts PII in an English sentence with Chinese label', () => {
    const input = 'Please reach me at email：alice@example.com or WeChat:alice_wechat'
    expect(redact(input)).toBe(`Please reach me at email：${R} or ${R}`)
  })
})

describe('redact – false-positive safety (normal numbers must NOT be redacted)', () => {
  it('does not redact a year', () => {
    expect(redact('2019年毕业')).toBe('2019年毕业')
  })

  it('does not redact GPA', () => {
    expect(redact('GPA 3.5/4.0')).toBe('GPA 3.5/4.0')
  })

  it('does not redact a percentage', () => {
    expect(redact('完成度 85%')).toBe('完成度 85%')
  })

  it('does not redact a 4-digit number by itself', () => {
    expect(redact('排名 1234')).toBe('排名 1234')
  })

  it('leaves plain text unchanged', () => {
    const plain = '本科毕业，主修计算机科学，GPA 3.8，热爱编程。'
    expect(redact(plain)).toBe(plain)
  })
})
