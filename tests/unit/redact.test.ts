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

// ---- 固定验收语料（2026-11-05 lane B 安全审查、提交审查和两次独立复查）------------------------
// redact() 的完成标准只有三条：MUST_HIDE 全部遮住；MUST_KEEP 一个不变；4 万字的恶意输入线性完成。
// 之后报出的新写法，除非是现有类别里的明显漏洞（例如某种常见的电话格式），否则不改正则，
// 记进 docs/DECISIONS.md 的已接受风险（补偿控制：举报、运营抽查、企业端只看脱敏文本、联系方式要解锁）。

/** [输入, 输出里不能再出现的秘密片段] */
const MUST_HIDE: [string, string][] = [
  // 微信：关键词、别名、连接词、ID 后缀、括号和引号、@ 前缀
  ['微信：abc123', 'abc123'],
  ['Contact me WeChat: myid_2024', 'myid_2024'],
  ['wx leakwx0420', 'leakwx0420'],
  ['加我微信 wechat123', 'wechat123'],
  ['微信号：wxid_abc123', 'wxid_abc123'],
  ['微信号 abc_123', 'abc_123'],
  ['加我vx: abc_123', 'abc_123'],
  ['VX：abc123', 'abc123'],
  ['V信 abc123', 'abc123'],
  ['wechat id: abc.123', 'abc.123'],
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
  ['微信 alicewong', 'alicewong'],
  ['微信alicewong', 'alicewong'],
  ['vx alicewong', 'alicewong'],
  ['wx alicewong', 'alicewong'],
  ['WeChat alicewong', 'alicewong'],
  ['Find me on WeChat alicewong.', 'alicewong'],
  ['WeChat alicewong 欢迎联系', 'alicewong'],
  ['WeChat: alicewong', 'alicewong'],
  ['WeChat ID alicewong', 'alicewong'],
  ['WeChat ID is alicewong', 'alicewong'],
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
  ['微信 abcdefghij_abcdefghij_abcdefghij_abcdefghij', 'abcdefghij'],

  // 马来西亚、中国的手机号和固话：各种分组、分隔符和前缀
  ['+60 12-000 0420', '0420'],
  ['+60123456789', '3456789'],
  ['012-345 6789', '6789'],
  ['联系电话 012-3456789 谢谢', '3456789'],
  ['+86 138 1234 5678', '5678'],
  ['手机 13812345678', '13812345678'],
  ['138 1234 5678', '5678'],
  ['138-1234-5678', '5678'],
  ['电话：138 1234 5678', '5678'],
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
  ['0123 456 789', '456 789'],
  ['0123-456789', '456789'],
  ['012 34 56 789', '56 789'],
  ['60 123 456 789', '456 789'],
  ['1381 234 5678', '5678'],
  ['138 123 45678', '45678'],
  ['012−345−6789', '6789'],
  ['012_345_6789', '6789'],
  ['012~345~6789', '6789'],
  ['012/345/6789', '6789'],
  ['138/1234/5678', '5678'],
  ['03-1234 5678', '5678'],
  ['(03) 7967 1234', '1234'],
  ['021-12345678', '12345678'],
  ['0060123456789', '0060123456789'],
  ['WhatsApp 012-345 6789', '6789'],
  ['088-123456', '123456'],
  ['082-123 456', '123 456'],
  ['(089) 123 456', '123 456'],

  // 全角、零宽、格式字符、带圈和数学字体数字
  ['１３８１２３４５６７８', '５６７８'],
  ['012​3456789', '3456789'],
  ['+60​12​3456789', '3456789'],
  ['138‌1234‍5678', '5678'],
  ['0‭12-345 6789', '6789'],
  ['0‎1‎2‎ ‎3‎4‎5‎ ‎6‎7‎8‎9', '9'],
  ['012️3456789', '3456789'],
  ['012͏3456789', '3456789'],
  ['012᠎3456789', '3456789'],
  ['0⁡1⁢2-3456789', '3456789'],
  ['①③⑧①②③④⑤⑥⑦⑧', '⑤⑥⑦⑧'],
  ['\u{1D7CE}\u{1D7CF}\u{1D7D0}-\u{1D7D1}\u{1D7D2}\u{1D7D3} \u{1D7D4}\u{1D7D5}\u{1D7D6}\u{1D7D7}', '\u{1D7D7}'],
  ['ｗｘ：ａｂｃ１２３', 'ａｂｃ１２３'],

  // 邮箱：常规、中文句号、﹫、(at)/[at]、汉字本地部分、at/dot 拼写、带空格的 @、空域名段、超长前缀
  ['leak-sentinel@example.test', 'leak-sentinel'],
  ['user@mail.example.com', 'user'],
  ['邮箱 alice@gmail。com', 'alice'],
  ['alice @ gmail.com', 'alice'],
  ['alice﹫gmail.com', 'alice'],
  ['alice(at)gmail.com', 'alice'],
  ['alice[at]gmail.com', 'alice'],
  ['王明@qq.com', '王明'],
  ['alice at gmail dot com', 'alice'],
  ['alice.wong at outlook dot com', 'alice.wong'],
  ['alice at gmail.com', 'alice'],
  ['alice@gmail dot com', 'alice'],
  ['alice(at)gmail(dot)com', 'alice'],
  ['alice [at] gmail [dot] com', 'alice'],
  ['alice【at】gmail.com', 'alice'],
  ['alice@gmail..com', 'alice'],
  ['alice@.gmail.com', 'alice'],
  ['alice@a.b.c.d.e.f.g.com', 'alice'],
  ['-'.repeat(62) + 'alice@gmail.com', 'alice'],
  ['.'.repeat(70) + 'bob@qq.com', 'bob'],
  ['x'.repeat(80) + '@gmail.com', 'xxxxxxxx'],
  ['alice.wong @ example.com', 'alice.wong'],
  ['alice2024 @ example.com', 'alice2024'],
  ['alice @ alice.dev', 'alice'],
  ['wang.ming @ um.edu.my', 'wang.ming'],
  ['邮箱 alice @ example.com', 'alice'],
  ['Email: alice @ example.com', 'alice'],

  // 网址和社交平台
  ['https://example.com/profile', 'example.com'],
  ['www.example.com/me', 'example.com'],
  ['linkedin.com/in/abc', 'abc'],
  ['github.com/abc', 'abc'],
  ['t.me/abc_handle', 'abc_handle'],
  ['wa.me/60123456789', '60123456789'],
  ['https://wa.me/60123456789', '60123456789'],
  ['api.whatsapp.com/send?phone=60123456789', '60123456789'],
  ['whatsapp.com/send?phone=60123456789', '60123456789'],
  ['linkedin.com/in/王明-a1b2c3', '王明'],
  ['https://example.com/u/王明明', '王明明'],
  ['t.me/王明_2024', '王明'],
  ['https://vk.com/иван_петров', 'иван'],
  ['instagram.com/alice.wong', 'alice.wong'],
  ['facebook.com/alice.wong', 'alice.wong'],
  ['x.com/alicewong', 'alicewong'],
  ['tiktok.com/@alicewong', 'alicewong'],
  ['u.wechat.com/abcDEF123', 'abcDEF123'],

  // QQ、Telegram、Line、IG
  ['QQ：123456789', '123456789'],
  ['QQ号 12345', '12345'],
  ['QQ号码：12345678', '12345678'],
  ['QQ号是：12345678', '12345678'],
  ['Telegram: @abc_handle', 'abc_handle'],
  ['TG @abc_handle', 'abc_handle'],
  ['Telegram: alice_tg', 'alice_tg'],
  ['Line ID: abc123', 'abc123'],
  ['Line ID abc123', 'abc123'],
  ['Line: alice123', 'alice123'],
  ['IG: @alice.wong', 'alice.wong'],
  ['IG: alice.wong', 'alice.wong'],
  ['Telegram: alicewong', 'alicewong'],
  ['Line ID alicewong', 'alicewong'],
]

/** 正常文本：输出必须和输入逐字相同 */
const MUST_KEEP: string[] = [
  // 技术栈和版本
  'Node.js、Next.js 和 Vue.js',
  'ASP.NET Core / C# / .NET 8',
  'React.js 18 / Express.js / HTML5/CSS3',
  'v1.2.3，TypeScript 5.4，Python 3.12',
  // 成绩、年份、日期、比例、金额、编号
  'GPA 3.85/4.00，CGPA 3.67',
  '2019-2023 就读，2024-06-30 毕业',
  '提升 35%，增长 120%',
  'RM 3500',
  '学号 2021A1234，排名 12/300',
  '排名 150/2000 2023 年',
  '获得 2 项专利（申请号 202310123456）',
  'IELTS 7.5',
  // 微信相关的产品名和普通说法
  '熟悉微信小程序开发',
  '负责微信公众号运营',
  'WeChat Pay 接入',
  'WeChat mini-program development',
  'WeChat Mini Program',
  'WeChat official account 运营',
  'WeChat payments integration',
  'WeChat development',
  'WeChat ecosystem',
  'Developed a WeChat Programme for students',
  'Built a WeChat Miniprogramme feature',
  'Built a WeChat Analytics feature',
  'Built a WeChat Enterprise feature',
  'Integrated WeChat Translate and Alipay',
  'WeChat Public Account operations',
  'WeChat/Alipay payment integration',
  '可通过微信/WhatsApp联系',
  'Built a WeChat-based ordering system',
  'Built a WeChat-integrated ordering system',
  'WeChat-Pay',
  'WeChat is the most popular app in China',
  'WeChat is widely used in China',
  'WeChat ID verification',
  '微信 300 万用户',
  '运营微信 2000 粉丝社群',
  'WeChat 8.0 adaptation',
  // 普通英文里的 at / dot / line / id，以及求职头衔里的 @
  'look at this dot com bubble',
  'arrive at noon',
  'Python 3.12 at work',
  'Production line id 5',
  'Intern @ Shopee.com.my',
  'Data Analyst @ Fave.co',
  // 其他
  '熟悉 vxe-table',
  'VXLAN-EVPN 实验',
  '你好​世界',
  // 最终复查发现的误伤：日期区间、英文句子里 WeChat 后面的普通词、平台名后面的普通内容
  '2021-09-01 - 2025-06-30',
  '项目周期 2023.03.01 - 2023.06.30',
  '01.09.2021 - 30.06.2025',
  '就读时间：2019.09 - 2023.06',
  'Users can log in through WeChat within seconds',
  'Promoted on WeChat through campaigns and content',
  'Product line: consumer electronics',
  'IG: 5000 followers',
  'Facebook: 10 posts per week',
  'Students use WeChat daily.',
  'Experienced with WeChat development.',
]

/** 匹配以外的文字和标点要原样保留：[输入, 期望输出] */
const EXACT: [string, string][] = [
  ['我的微信是 alice_2024，欢迎联系', `我的${R}，欢迎联系`],
  ['电话 012​3456789 谢谢', `电话 ${R} 谢谢`],
  ['WeChat：alice_2024。谢谢', `${R}。谢谢`],
  ['电话 60123456789', `电话 ${R}`],
  ['主页 https://example.com/me，欢迎访问', `主页 ${R}，欢迎访问`],
  ['作品集：https://alice.dev。本人就读于马来亚大学', `作品集：${R}。本人就读于马来亚大学`],
  ['项目地址github.com/alice/shop（基于Next.js和Prisma）。该项目获奖。', `项目地址${R}（基于Next.js和Prisma）。该项目获奖。`],
  ['“https://alice.dev”是我的博客', `“${R}”是我的博客`],
  ['作品集见 https://alice.github.io，谢谢', `作品集见 ${R}，谢谢`],
  ['邮箱 user@test.com，电话 +60 12-345 6789，微信 wx_abc', `邮箱 ${R}，电话 ${R}，${R}`],
]

const N = 40_000
/** 每个形状约 4 万字，专门针对各条规则的回溯点 */
const MALICIOUS: [string, string][] = [
  ['letters', 'a'.repeat(N)],
  ['a@ + digits', 'a@' + '1'.repeat(N)],
  ['digits', '1'.repeat(N)],
  ['dots', '.'.repeat(N)],
  ['dashes + @', '-'.repeat(N) + '@'],
  ['a@ + 1.', 'a@' + '1.'.repeat(N / 2)],
  ['0 + 1-', '0' + '1-'.repeat(N / 2)],
  ['微信 repeated', '微信'.repeat(N / 2)],
  ['vx repeated', 'vx'.repeat(N / 2)],
  ['-wx repeated', '-wx'.repeat(N / 3)],
  ['vx- repeated', 'vx-'.repeat(N / 3)],
  ['微信-a repeated', '微信-a'.repeat(N / 4)],
  ['wx a1 repeated', 'wx a1'.repeat(N / 5)],
  ['微信 + letters', '微信 ' + 'a'.repeat(N)],
  ['微信： + letters', '微信：' + 'a'.repeat(N)],
  ['WeChat ID repeated', 'WeChat ID '.repeat(N / 10)],
  ['WeChat-a repeated', 'WeChat-a'.repeat(N / 8)],
  ['https + Han', 'https://' + '王'.repeat(N)],
  ['https + /Han', 'https://' + '/王'.repeat(N / 2)],
  ['Han run', '汉'.repeat(N)],
  ['+60 separators', '+60' + ' -'.repeat(N / 2)],
  ['( + zeros', '('.repeat(N / 2) + '0'.repeat(N / 2)],
  ['QQ spaced', 'QQ   号   :   '.repeat(N / 14)],
  ['x at', 'x at '.repeat(N / 5)],
  ['a @', 'a @ '.repeat(N / 4)],
  ['Han @ spaced', '汉汉汉汉汉汉  @  '.repeat(N / 11)],
  ['line id a1', 'line id a1'.repeat(N / 10)],
  ['zero-width digits', '1​'.repeat(N / 2)],
  ['circled digits', '①'.repeat(N)],
  ['math digits', '\u{1D7CF}'.repeat(N / 2)],
]

describe('redact – 固定验收语料', () => {
  it.each(MUST_HIDE)('遮住 %j', (input, secret) => {
    const out = redact(input)
    expect(out).toContain(R)
    expect(out).not.toContain(secret)
  })

  it.each(MUST_KEEP)('不动 %j', (input) => {
    expect(redact(input)).toBe(input)
  })

  it.each(EXACT)('保留上下文 %j', (input, expected) => {
    expect(redact(input)).toBe(expected)
  })

  // 二次回溯在 4 万字上是秒级；上限放宽到 250ms，给慢的 CI 机器留余量
  it.each(MALICIOUS)('4 万字恶意输入线性完成：%s', (_name, input) => {
    const t = performance.now()
    redact(input)
    expect(performance.now() - t).toBeLessThan(250)
  })
})
