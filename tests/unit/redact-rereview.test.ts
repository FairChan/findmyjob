import { describe, expect, it } from 'vitest'
import { redact, REDACTED as R } from '@/lib/redact'

// Cases from the independent re-review of f79f286 + 11f05dd (2026-11-05).
function expectHidden(input: string, secret: string) {
  const out = redact(input)
  expect(out).toContain(R)
  expect(out).not.toContain(secret)
}

describe('redact re-review – leaks', () => {
  it.each([
    // double connector / "ID:" / @ / quotes
    ['微信ID：alice2024', 'alice2024'],
    ['微信 ID: alice2024', 'alice2024'],
    ['wx id: alice2024', 'alice2024'],
    ['vx id：alice2024', 'alice2024'],
    ['我的微信号是：alice2024', 'alice2024'],
    ['微信号为: alice2024', 'alice2024'],
    ['My WeChat ID is: alice2024', 'alice2024'],
    ['微信：@alice2024', 'alice2024'],
    ['微信“alice_2024”', 'alice_2024'],
    ['微信："alice_2024"', 'alice_2024'],
    ['微信：『alice_2024』', 'alice_2024'],
    ['微信 Pay-alicewong', 'alicewong'],
    ['微信 api-wangming', 'wangming'],
    ['vx apps.zhangsan', 'zhangsan'],
    // QQ
    ['QQ号码：12345678', '12345678'],
    ['QQ号是：12345678', '12345678'],
    // mixed at/dot for listed providers, empty labels
    ['alice at gmail.com', 'alice'],
    ['alice@gmail dot com', 'alice'],
    ['alice(at)gmail(dot)com', 'alice'],
    ['alice [at] gmail [dot] com', 'alice'],
    ['alice【at】gmail.com', 'alice'],
    ['alice@gmail..com', 'alice'],
    ['alice@.gmail.com', 'alice'],
    // phone groupings
    ['0123 456 789', '456 789'],
    ['0123-456789', '456789'],
    ['012 34 56 789', '56 789'],
    ['60 123 456 789', '456 789'],
    ['1381 234 5678', '5678'],
    ['138 123 45678', '45678'],
    ['012−345−6789', '6789'],
    ['012_345_6789', '6789'],
    ['012~345~6789', '6789'],
    // invisible / look-alike characters
    ['0‭12-345 6789', '6789'],
    ['0‎1‎2‎ ‎3‎4‎5‎ ‎6‎7‎8‎9', '9'],
    ['012️3456789', '3456789'],
    ['012͏3456789', '3456789'],
    ['012᠎3456789', '3456789'],
    ['0⁡1⁢2-3456789', '3456789'],
    ['①③⑧①②③④⑤⑥⑦⑧', '⑤⑥⑦⑧'],
    // landlines and 00 prefix
    ['03-1234 5678', '5678'],
    ['(03) 7967 1234', '1234'],
    ['021-12345678', '12345678'],
    ['0060123456789', '0060123456789'],
    // social links and handles
    ['instagram.com/alice.wong', 'alice.wong'],
    ['facebook.com/alice.wong', 'alice.wong'],
    ['x.com/alicewong', 'alicewong'],
    ['tiktok.com/@alicewong', 'alicewong'],
    ['u.wechat.com/abcDEF123', 'abcDEF123'],
    ['Telegram: alice_tg', 'alice_tg'],
    ['Line: alice123', 'alice123'],
    ['IG: @alice.wong', 'alice.wong'],
    // long tails must not leave a remainder
    ['微信 abcdefghij_abcdefghij_abcdefghij_abcdefghij', 'abcdefghij'],
  ])('%j', (input, secret) => expectHidden(input, secret))

  it('keeps the original separators outside a match', () => {
    expect(redact('WeChat：alice_2024。谢谢')).toBe(`${R}。谢谢`)
    expect(redact('电话 60123456789')).toBe(`电话 ${R}`)
  })
})

// Commit security review of 5452dab.
describe('redact re-review – review of 5452dab', () => {
  it.each([
    ['WeChat ID alicewong', 'alicewong'],
    ['alice.wong @ example.com', 'alice.wong'],
    ['alice2024 @ example.com', 'alice2024'],
    ['邮箱 alice @ example.com', 'alice'],
    ['Email: alice @ example.com', 'alice'],
    ['Line ID abc123', 'abc123'],
    ['012/345/6789', '6789'],
    ['138/1234/5678', '5678'],
    ['https://vk.com/иван_петров', 'иван'],
    ['WeChat ID is alicewong', 'alicewong'],
    ['alice @ alice.dev', 'alice'],
    ['wang.ming @ um.edu.my', 'wang.ming'],
  ])('%j', (input, secret) => expectHidden(input, secret))

  it.each([
    'WeChat ID verification',
    'Intern @ Shopee.com.my',
    'Data Analyst @ Fave.co',
    'Production line id 5',
    '排名 150/2000 2023 年',
    'Built a WeChat-integrated ordering system',
    'WeChat is widely used in China',
    'Developed a WeChat Programme for students',
  ])(
    'does not touch %s',
    (input) => expect(redact(input)).toBe(input),
  )

  it.each([['-wx'.repeat(30_000)], ['vx-'.repeat(30_000)], ['微信-a'.repeat(20_000)], ['wx a1'.repeat(20_000)]])(
    'repeated keywords stay linear (%#)',
    (input) => {
      const t = performance.now()
      redact(input)
      // generous bound for slow CI; quadratic behaviour shows up as seconds, not ms
      expect(performance.now() - t).toBeLessThan(250)
    },
  )
})

describe('redact re-review – ordinary text stays unchanged', () => {
  it.each([
    // English "WeChat <word>" in résumés
    'Developed a WeChat Programme for students',
    'Built a WeChat Miniprogramme feature',
    'Built a WeChat Analytics feature',
    'Built a WeChat Enterprise feature',
    'Integrated WeChat Translate and Alipay',
    'WeChat Public Account operations',
    // connectors that are ordinary text
    'WeChat/Alipay payment integration',
    '可通过微信/WhatsApp联系',
    'Built a WeChat-based ordering system',
    'WeChat-Pay',
    'WeChat is the most popular app in China',
    'WeChat ID verification',
    // numbers after 微信
    '微信 300 万用户',
    '运营微信 2000 粉丝社群',
    'WeChat 8.0 adaptation',
    // @ with spaces in job titles
    'Intern @ Shopee.com.my',
    'Data Analyst @ Fave.co',
    // misc
    '排名 150/2000 2023 年',
    'Production line id 5',
    '熟悉 vxe-table',
    'VXLAN-EVPN 实验',
  ])('%s', (input) => expect(redact(input)).toBe(input))

  it('does not swallow the Chinese text after a URL', () => {
    expect(redact('作品集：https://alice.dev。本人就读于马来亚大学')).toBe(`作品集：${R}。本人就读于马来亚大学`)
    expect(redact('项目地址github.com/alice/shop（基于Next.js和Prisma）。该项目获奖。')).toBe(
      `项目地址${R}（基于Next.js和Prisma）。该项目获奖。`,
    )
    expect(redact('“https://alice.dev”是我的博客')).toBe(`“${R}”是我的博客`)
    expect(redact('作品集见 https://alice.github.io，谢谢')).toBe(`作品集见 ${R}，谢谢`)
  })

  it('still covers non-ASCII path segments', () => {
    expectHidden('linkedin.com/in/王明-a1b2c3', '王明')
    expectHidden('https://example.com/u/王明明', '王明明')
  })
})
