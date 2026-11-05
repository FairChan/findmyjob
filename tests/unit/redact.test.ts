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

describe('redact – Chinese mobile without country code', () => {
  it('replaces bare 11-digit Chinese mobile', () => {
    expect(redact('13812345678')).toBe(R)
  })

  it('replaces Chinese mobile with spaces', () => {
    expect(redact('138 1234 5678')).toBe(R)
  })

  it('replaces Chinese mobile with hyphens', () => {
    expect(redact('138-1234-5678')).toBe(R)
  })

  it('replaces full-width Chinese mobile', () => {
    expect(redact('１３８１２３４５６７８')).toBe(R)
  })

  it('does not redact bare 11-digit number preceded by another digit', () => {
    // e.g. a longer ID number should not trip the phone pattern
    expect(redact('学号 213812345678')).toBe('学号 213812345678')
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

describe('redact – WeChat aliases', () => {
  it('replaces 微信号：<id>', () => {
    expect(redact('微信号：wxid_abc123')).toBe(R)
  })

  it('replaces 微信号 <id> (space separator)', () => {
    expect(redact('微信号 abc_123')).toBe(R)
  })

  it('replaces vx: <id>', () => {
    expect(redact('加我vx: abc_123')).toBe(`加我${R}`)
  })

  it('replaces VX：<id>', () => {
    expect(redact('VX：abc123')).toBe(R)
  })

  it('replaces V信 <id>', () => {
    expect(redact('V信 abc123')).toBe(R)
  })

  it('replaces wechat id: <id>', () => {
    expect(redact('wechat id: abc.123')).toBe(R)
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

describe('redact – URLs without http(s)', () => {
  it('replaces www. prefixed URL', () => {
    expect(redact('www.example.com/me')).toBe(R)
  })

  it('replaces linkedin.com path', () => {
    expect(redact('linkedin.com/in/abc')).toBe(R)
  })

  it('replaces github.com path', () => {
    expect(redact('github.com/abc')).toBe(R)
  })

  it('replaces t.me handle', () => {
    expect(redact('t.me/abc_handle')).toBe(R)
  })
})

describe('redact – other contact platforms', () => {
  it('replaces QQ：<number>', () => {
    expect(redact('QQ：123456789')).toBe(R)
  })

  it('replaces QQ号 <number>', () => {
    expect(redact('QQ号 12345')).toBe(R)
  })

  it('replaces Telegram: @handle', () => {
    expect(redact('Telegram: @abc_handle')).toBe(R)
  })

  it('replaces TG @handle', () => {
    expect(redact('TG @abc_handle')).toBe(R)
  })

  it('replaces Line ID: <id>', () => {
    expect(redact('Line ID: abc123')).toBe(R)
  })

  it('replaces WhatsApp <phone>', () => {
    expect(redact('WhatsApp 012-345 6789')).toBe(R)
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

describe('redact – false-positive safety (tech names and formats)', () => {
  it('does not redact Node.js', () => {
    expect(redact('熟练掌握 Node.js')).toBe('熟练掌握 Node.js')
  })

  it('does not redact Next.js', () => {
    expect(redact('使用 Next.js 开发')).toBe('使用 Next.js 开发')
  })

  it('does not redact Vue.js', () => {
    expect(redact('Vue.js 组件')).toBe('Vue.js 组件')
  })

  it('does not redact ASP.NET', () => {
    expect(redact('ASP.NET 项目')).toBe('ASP.NET 项目')
  })

  it('does not redact C#', () => {
    expect(redact('语言：C#')).toBe('语言：C#')
  })

  it('does not redact .NET', () => {
    expect(redact('.NET Framework')).toBe('.NET Framework')
  })

  it('does not redact TypeScript version', () => {
    expect(redact('TypeScript 5.4')).toBe('TypeScript 5.4')
  })

  it('does not redact semver version', () => {
    expect(redact('v1.2.3')).toBe('v1.2.3')
  })

  it('does not redact year range', () => {
    expect(redact('2019-2023 在读')).toBe('2019-2023 在读')
  })

  it('does not redact recent year', () => {
    expect(redact('2024年项目')).toBe('2024年项目')
  })

  it('does not redact GPA with two decimals', () => {
    expect(redact('GPA 3.85/4.00')).toBe('GPA 3.85/4.00')
  })

  it('does not redact percentage', () => {
    expect(redact('35%')).toBe('35%')
  })

  it('does not redact percentage increase', () => {
    expect(redact('提升 120%')).toBe('提升 120%')
  })

  it('does not redact Malaysian Ringgit amount', () => {
    expect(redact('RM 3500')).toBe('RM 3500')
  })

  it('does not redact student ID style short string', () => {
    expect(redact('学号 2021A1234')).toBe('学号 2021A1234')
  })

  it('does not redact ISO date', () => {
    expect(redact('2024-06-30')).toBe('2024-06-30')
  })
})

describe('redact – performance', () => {
  it('handles ~20KB text without PII within 1 second', () => {
    const chunk =
      '技术栈：TypeScript 5.4、Node.js、Next.js、Vue.js、C#、ASP.NET；2024年；GPA 3.85/4.00；v1.2.3；RM 3500；2021A1234；2024-06-30。'
    const longText = chunk.repeat(300)
    const start = Date.now()
    const result = redact(longText)
    const elapsed = Date.now() - start
    expect(result).toBe(longText)
    expect(elapsed).toBeLessThan(1000)
  })
})
