import { describe, expect, it } from 'vitest'
import { redact, REDACTED as R } from '@/lib/redact'

// Cases from the 2026-11-05 lane B security review: each input leaked a contact
// detail through redact(). The secret part must disappear; surrounding text stays.
function expectHidden(input: string, secret: string) {
  const out = redact(input)
  expect(out).toContain(R)
  expect(out).not.toContain(secret)
}

describe('redact hardening – WeChat with connectors and brackets', () => {
  it.each([
    ['我的微信是 alice_2024', 'alice_2024'],
    ['我的微信是alice_2024', 'alice_2024'],
    ['微信：（alice_2024）', 'alice_2024'],
    ['微信/alice_2024', 'alice_2024'],
    ['微信【alice_2024】', 'alice_2024'],
    ['微信 - alice_2024', 'alice_2024'],
    ['My WeChat is alice_2024', 'alice_2024'],
    ['Wechat: alice_2024', 'alice_2024'],
    ['WX: alice_2024', 'alice_2024'],
    ['加微信：wxid_k8s7d6f5', 'wxid_k8s7d6f5'],
  ])('%s', (input, secret) => expectHidden(input, secret))

  it('keeps surrounding text', () => {
    expect(redact('我的微信是 alice_2024，欢迎联系')).toBe(`我的${R}，欢迎联系`)
  })

  it.each([
    '熟悉微信小程序开发',
    '负责微信公众号运营',
    'WeChat Pay 接入',
    'WeChat mini-program development',
  ])('does not touch %s', (input) => expect(redact(input)).toBe(input))
})

describe('redact hardening – phone formats', () => {
  it.each([
    ['012.345.6789', '6789'],
    ['012–345 6789', '6789'],
    ['+60 12–345 6789', '6789'],
    ['012  345  6789', '6789'],
    ['012 - 345 6789', '6789'],
    ['(012) 345 6789', '6789'],
    ['(+60) 12-345 6789', '6789'],
    ['+60 12.345.6789', '6789'],
    ['60123456789', '60123456789'],
    ['6012-345 6789', '6789'],
    ['Tel0123456789', '0123456789'],
    ['电话：138 1234 5678', '5678'],
  ])('%s', (input, secret) => expectHidden(input, secret))
})

describe('redact hardening – invisible and look-alike characters', () => {
  it.each([
    ['012​3456789', '3456789'],
    ['+60​12​3456789', '3456789'],
    ['138‌1234‍5678', '5678'],
    ['\u{1D7CE}\u{1D7CF}\u{1D7D0}-\u{1D7D1}\u{1D7D2}\u{1D7D3} \u{1D7D4}\u{1D7D5}\u{1D7D6}\u{1D7D7}', '\u{1D7D7}'],
  ])('%j', (input, secret) => expectHidden(input, secret))

  it('keeps text around a removed zero-width match intact', () => {
    expect(redact('电话 012​3456789 谢谢')).toBe(`电话 ${R} 谢谢`)
  })

  it('leaves zero-width characters outside matches untouched', () => {
    expect(redact('你好​世界')).toBe('你好​世界')
  })
})

describe('redact hardening – email variants', () => {
  it.each([
    ['邮箱 alice@gmail。com', 'alice'],
    ['alice @ gmail.com', 'alice'],
    ['alice﹫gmail.com', 'alice'],
    ['alice(at)gmail.com', 'alice'],
    ['alice[at]gmail.com', 'alice'],
    ['王明@qq.com', '王明'],
    ['alice at gmail dot com', 'alice'],
    ['alice.wong at outlook dot com', 'alice.wong'],
  ])('%s', (input, secret) => expectHidden(input, secret))

  it.each([
    'look at this dot com bubble',
    'arrive at noon',
    'Python 3.12 at work',
  ])('does not touch %s', (input) => expect(redact(input)).toBe(input))
})

describe('redact hardening – WhatsApp and Telegram links', () => {
  it.each([
    ['wa.me/60123456789', '60123456789'],
    ['https://wa.me/60123456789', '60123456789'],
    ['api.whatsapp.com/send?phone=60123456789', '60123456789'],
    ['whatsapp.com/send?phone=60123456789', '60123456789'],
    ['t.me/abc_handle', 'abc_handle'],
  ])('%s', (input, secret) => expectHidden(input, secret))
})

describe('redact hardening – existing negatives still hold', () => {
  it.each([
    'Node.js、Next.js 和 Vue.js',
    'ASP.NET Core / C# / .NET 8',
    'GPA 3.85/4.00，CGPA 3.67',
    '2019-2023 就读，2024-06-30 毕业',
    '提升 35%，增长 120%',
    'RM 3500',
    'v1.2.3，TypeScript 5.4，Python 3.12',
    '学号 2021A1234，排名 12/300',
    '获得 2 项专利（申请号 202310123456）',
    'IELTS 7.5',
  ])('%s', (input) => expect(redact(input)).toBe(input))
})

describe('redact hardening – backtracking', () => {
  it.each([
    ['a'.repeat(100_000)],
    ['a@' + '1'.repeat(100_000)],
    ['1'.repeat(100_000)],
    ['微信'.repeat(20_000)],
    ['.'.repeat(100_000)],
  ])('long input finishes within 50ms (%#)', (input) => {
    const t = performance.now()
    redact(input)
    expect(performance.now() - t).toBeLessThan(50)
  })
})
