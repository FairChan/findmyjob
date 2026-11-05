export const REDACTED = '[已隐藏]'

// Format characters (zero-width, bidi controls, soft hyphen, BOM…) and combining / enclosing marks
// (variation selectors, keycaps) render as nothing or decorate a digit; drop them before matching.
const INVISIBLE = /[\p{Cf}\p{Mn}\p{Me}]/u
// Characters whose compatibility form is a single digit: styled digits, circled ①, superscript ¹.
const DIGIT_LIKE = /[\p{Nd}\p{No}]/u
// Look-alikes that a Chinese IME or a font picker produces instead of ASCII punctuation.
const AS_DOT = new Set([0x3002, 0xff61, 0xfe52]) // 。 ｡ ﹒
const AS_AT = new Set([0xfe6b]) // ﹫

// NFKC is the slow step; the set of digit-like code points is small and fixed, so memoize per code point.
const foldedDigits = new Map<number, string>()
function foldDigit(cp: number, ch: string): string {
  let out = foldedDigits.get(cp)
  if (out === undefined) {
    const folded = ch.normalize('NFKC')
    out = /^[0-9]$/.test(folded) ? folded : ch
    foldedDigits.set(cp, out)
  }
  return out
}

interface Normalized {
  text: string
  /** For each UTF-16 unit of `text`: [start, end) of the source code point in the input. */
  from: number[]
  to: number[]
}

/**
 * Builds the string the patterns run on, one code point at a time, and remembers where each
 * output unit came from. Matching happens on the normalized text; replacement happens on the
 * original, so anything outside a match is returned exactly as given.
 */
function normalize(input: string): Normalized {
  let text = ''
  const from: number[] = []
  const to: number[] = []
  for (let i = 0; i < input.length; ) {
    const cp = input.codePointAt(i)!
    const width = cp > 0xffff ? 2 : 1
    const ch = input.slice(i, i + width)
    let out: string
    if (cp < 0x80) out = ch
    else if (cp >= 0xff01 && cp <= 0xff5e) out = String.fromCharCode(cp - 0xfee0)
    else if (cp === 0x3000) out = ' '
    else if (AS_DOT.has(cp)) out = '.'
    else if (AS_AT.has(cp)) out = '@'
    else if (INVISIBLE.test(ch)) out = ''
    else if (DIGIT_LIKE.test(ch)) out = foldDigit(cp, ch)
    else out = ch
    for (let k = 0; k < out.length; k++) {
      from.push(i)
      to.push(i + width)
    }
    text += out
    i += width
  }
  return { text, from, to }
}

// ---- building blocks ---------------------------------------------------------------------------

// Separator allowed between any two digits of a phone number (no "/": "150/2000" is a ratio).
const DSEP = String.raw`[\s\-‐-―−.()_~·‧•]{0,3}`
const D = String.raw`${DSEP}\d`

const MAIL_PROVIDERS = String.raw`(?:gmail|googlemail|yahoo|hotmail|outlook|live|icloud|qq|foxmail|163|126|yeah|sina|sohu|aliyun|proton(?:mail)?)`
const TLD = String.raw`(?:com|net|org|cn|my|edu)(?:\.[a-z]{2})?\b`
// Empty labels ("gmail..com", "@.gmail.com") are still an address a human can read.
const DOMAIN = String.raw`\.{0,3}[A-Za-z0-9\-]{1,63}(?:\.{1,3}[A-Za-z0-9\-]{1,63}){0,10}\.{1,3}[A-Za-z]{2,24}`
// The look-behind pins each attempt to the start of a run, so the unbounded `+` stays linear.
const ASCII_LOCAL = String.raw`(?<![A-Za-z0-9._%+\-])[A-Za-z0-9._%+\-]+`
const HAN_LOCAL = String.raw`\p{Script=Han}{1,6}`
const AT_WORD = String.raw`(?:@|[(\[【]\s?at\s?[)\]】]|\bat\b)`
const DOT_WORD = String.raw`(?:\.|[(\[【]\s?dot\s?[)\]】]|\bdot\b)`

// RFC 3986 characters minus the ones that end a sentence or wrap a link: , ; ' " ( ) < >
const URL_CHAR = String.raw`[A-Za-z0-9\-._~:/?#\[\]@!$&*+=%]`
// Non-ASCII letters are allowed only as a path segment right after / - _ = (linkedin.com/in/王明-a1b2c3),
// so the Chinese sentence that follows a link stays readable.
const URL_TAIL = String.raw`(?:${URL_CHAR}|(?<=[\/\-_=])\p{L}{1,20})+`

const WECHAT_CN = String.raw`(?:微信号?|威信|(?<![A-Za-z])[vV](?:[xX]|信)(?![A-Za-z])|(?<![A-Za-z])[wW][xX](?![A-Za-z]))`
const WECHAT_EN = String.raw`(?:\bwechat\b|\bweixin\b)`
// Case-spelled so the lowercase-handle rule can run without the i flag.
const WECHAT_EN_CS = String.raw`(?:\b[wW][eE][cC][hH][aA][tT]\b|\b[wW][eE][iI][xX][iI][nN]\b)`
const WECHAT_ANY = String.raw`(?:${WECHAT_CN}|${WECHAT_EN})`
const ID_SUFFIX = String.raw`(?:\s{0,3}(?:号码?|id\b))?\s{0,3}`
const STRONG = String.raw`(?:[:=]|是|为|→)`
const WEAK = String.raw`(?:[\-–—/]|is\b)`
const OPEN = String.raw`\s{0,3}[(\[【「『《<“"'‘]?\s{0,3}@?`
const TOKEN_ANY = String.raw`[A-Za-z0-9][A-Za-z0-9_.\-]{2,}`
// The look-ahead is bounded: unbounded, it rescans the rest of the run at every keyword ('-wx' × 30k).
// WeChat IDs start with a letter; plain numbers after 微信 ("微信 300 万用户") are counts, not IDs.
const TOKEN_IDLIKE = String.raw`(?:[A-Za-z](?=[A-Za-z0-9_.\-]{0,63}[0-9_])[A-Za-z0-9_.\-]{2,}|\d{5,})`
// Words that follow 微信 / vx in résumés without being an account (only 6+ letters matter here).
const PRODUCT_WORDS = String.raw`(?:payments?|alipay|grabpay|mini-?program(?:me)?s?|program(?:me)?s?|official|public|accounts?|enterprise|subscriptions?|articles?|moments|channels?|stores|groups|js-?sdk|applets?|openid|unionid|platforms?|develop(?:er|ers|ment)?|marketing|ecosystem|integrations?|search|advertising|analytics|wallet|merchants?|services?|support|customers?|operations?|business|messag(?:e|es|ing)|notifications?|chatbots?|translate|backend|frontend|server|mobile|android|html5|version|verification|authentication|promotions?|livestream(?:ing)?|international|global|cross-?border|e-?commerce|whatsapp|telegram|douyin|xiaohongshu|tencent|shopee|lazada|malaysia|singapore|features?|website|uni-?app|integrated|powered|enabled|compatible|friendly|related|ordering|booking|community|chatting|sharing|scanning|stickers?|contacts|friends|widely|popular|official)(?![A-Za-z0-9_\-]|\.[A-Za-z0-9])`
const TOKEN_LETTERS = String.raw`(?!${PRODUCT_WORDS})[A-Za-z][A-Za-z0-9_.\-]{5,}`

// LINE is handled separately below because "line" is also an ordinary English word.
const SOCIAL = String.raw`(?:\btelegram\b|\btg\b|\big\b|\binstagram\b|\bfacebook\b|\bfb\b|\btwitter\b|\btiktok\b|小红书|抖音|微博)`

const rx = (source: string, flags = 'gi') => new RegExp(source, flags)

// Every attempt is anchored by a literal or a look-behind, and no two adjacent quantified pieces
// can match the same characters, so matching stays linear on long free text.
const PATTERNS: RegExp[] = [
  // URLs: with a scheme, www., and scheme-less hosts that identify a person on their own
  rx(String.raw`https?:\/\/${URL_TAIL}`, 'giu'),
  rx(String.raw`\bwww\.${URL_TAIL}`, 'giu'),
  rx(String.raw`\b(?:linkedin|github|gitlab|instagram|facebook|fb|twitter|x|tiktok|weibo|xiaohongshu|douyin)\.com\/${URL_TAIL}`, 'giu'),
  rx(String.raw`\b(?:t\.me|wa\.me|wa\.link|xhslink\.com|u\.wechat\.com|v\.douyin\.com)\/${URL_TAIL}`, 'giu'),
  rx(String.raw`\b(?:api\.)?whatsapp\.com\/${URL_TAIL}`, 'giu'),

  // Email: plain; Han local part (spaces allowed); listed providers with any at/dot spelling
  rx(String.raw`${ASCII_LOCAL}@${DOMAIN}`, 'gu'),
  rx(String.raw`${HAN_LOCAL}\s{0,2}@\s{0,2}${DOMAIN}`, 'gu'),
  // spaces around @ only when the local part looks like an address (lowercase, or has a digit . _)
  // or follows a contact word — so "Intern @ Shopee.com.my" stays readable
  rx(String.raw`(?<![A-Za-z0-9._%+\-])(?:[a-z0-9._%+\-]+|(?=[A-Za-z0-9._%+\-]{0,64}[0-9._])[A-Za-z0-9._%+\-]+)\s{0,2}@\s{0,2}${DOMAIN}`, 'gu'),
  // the contact word is context only (look-behind), so "邮箱 " itself stays visible
  rx(String.raw`(?<=(?:e-?mail|mail|邮箱|邮件|电邮|contact)\s{0,3}[:=]?\s{0,3})${ASCII_LOCAL}\s{0,2}@\s{0,2}${DOMAIN}`, 'giu'),
  rx(String.raw`(?:${ASCII_LOCAL}|${HAN_LOCAL})\s{0,3}[(\[【]\s?at\s?[)\]】]\s{0,3}${DOMAIN}`, 'giu'),
  rx(String.raw`${ASCII_LOCAL}\s{0,3}${AT_WORD}\s{0,3}${MAIL_PROVIDERS}\s{0,3}${DOT_WORD}\s{0,3}${TLD}`, 'giu'),

  // Phones, matched by digit count rather than grouping — but the operator / area prefix must be
  // written unbroken (012, 011, 03…), otherwise date ranges like "09-01 - 2025-06-30" look like numbers
  // Malaysia mobile: +60 / (+60) / 0060 / 60 / 0, then 1X and 7–8 more digits
  rx(String.raw`(?<![0-9])(?:(?:\(\s?\+?\s?(?:00\s?)?60\s?\)|\+?\s?(?:00\s?)?60)${DSEP}|\(?0)1[0-9](?:${D}){7,8}(?![0-9])`, 'g'),
  // Malaysia landline: area code written unbroken (03–09, East Malaysia 082–089), then the real
  // 3–4 + 4 grouping, or 3 + 3 for East Malaysia's 6-digit numbers (088-123456)
  rx(String.raw`(?<![0-9])\(?0(?:8[2-9]|[3-9])\)?${DSEP}(?:\d{3,4}${DSEP}\d{4}|\d{3}${DSEP}\d{3})(?![0-9])`, 'g'),
  // Mainland China mobile, with or without +86
  rx(String.raw`(?<![0-9])(?:(?:\(\s?\+?\s?86\s?\)|\+?\s?86)${DSEP})?1[3-9](?:${D}){9}(?![0-9])`, 'g'),
  // Mainland China landline: area code, a dash, 7–8 digits
  rx(String.raw`(?<![0-9])0[1-9]\d{1,2}[\-‐-―−]\d{7,8}(?![0-9])`, 'g'),
  // Slash-separated phones, exact shape only (a general "/" separator would hit ratios like 150/2000)
  rx(String.raw`(?<![0-9])(?:01\d\/\d{3,4}|1[3-9]\d\/\d{4})\/\d{4}(?![0-9])`, 'g'),
  // Any other +CC number
  rx(String.raw`\+[1-9]\d{0,2}(?:${D}){6,14}(?![0-9])`, 'g'),

  // WeChat — strong connector (：= 是 为 →, optionally after a weak one): any handle
  rx(String.raw`${WECHAT_ANY}${ID_SUFFIX}(?:(?:${WEAK}|${STRONG})\s{0,3})?${STRONG}${OPEN}${TOKEN_ANY}`),
  // weak connector (- / is) or none: only ID-like handles (a digit or _), so "WeChat-based",
  // "WeChat/Alipay", "WeChat is popular" stay as written
  rx(String.raw`${WECHAT_ANY}${ID_SUFFIX}(?:${WEAK}\s{0,3})?${OPEN}${TOKEN_IDLIKE}`),
  // after 微信 / vx / wx only: a letters-only handle of 6+ that is not a product word
  rx(String.raw`${WECHAT_CN}${ID_SUFFIX}(?:${WEAK}\s{0,3})?${OPEN}${TOKEN_LETTERS}`),

  // English keyword: after an explicit "ID", any letters-only handle that is not a product word
  rx(String.raw`${WECHAT_EN}\s{0,3}id\b\s{0,3}(?:(?:${WEAK}|${STRONG})\s{0,3})?${OPEN}${TOKEN_LETTERS}`),
  // English keyword without ID: a lowercase handle of 6+ only when it ends the text or is followed by
  // punctuation or Chinese ("WeChat alicewong。", "WeChat alicewong 欢迎联系"). In an English sentence
  // the next word follows ("through WeChat within seconds"), so ordinary words are left alone.
  rx(
    String.raw`${WECHAT_EN_CS}\s{0,3}(?:[\-–—/]\s{0,3})?${OPEN}(?!${PRODUCT_WORDS})[a-z][a-z0-9_\-]{5,}(?:\.[a-z0-9_\-]+)*(?=\s{0,3}(?:$|[.,;:!?)\]、）】]|[^\x00-\x7F]))`,
    'gm',
  ),

  // QQ, other platforms' handles, WhatsApp with a number
  rx(String.raw`QQ\s{0,3}(?:号码?)?\s{0,3}(?:(?:[:=]|是|为)\s{0,3}){0,2}\d{5,12}(?![0-9])`),
  // explicit platform + ：/=: any handle except a short number or a product word
  // ("IG: 5000 followers", "Facebook: marketing campaigns" stay as written)
  rx(String.raw`${SOCIAL}\s{0,3}(?:id\s{0,3})?[:=]\s{0,3}@?(?!\d{1,4}(?![A-Za-z0-9_.\-]))(?!${PRODUCT_WORDS})${TOKEN_ANY}`),
  // LINE is also an English word ("Product line: consumer electronics"): after "line" only ID-like
  // handles, after "line id" any
  rx(String.raw`\bline\s{0,3}[:=]\s{0,3}(?:@[A-Za-z0-9_.]{2,}|${TOKEN_IDLIKE})`),
  rx(String.raw`\bline\s{1,3}id\s{0,3}[:=]?\s{0,3}@?${TOKEN_ANY}`),
  rx(String.raw`(?:\btelegram\b|\btg\b|\big\b|\binstagram\b|\btwitter\b|\btiktok\b)\s{0,3}@[A-Za-z0-9_.]{2,}`),
  rx(String.raw`\bwhats\s?app\b\s{0,3}(?:[:=]|is\b)?\s{0,3}\+?[0-9][\d\s\-]{7,15}`),
]

const EDGE_TRIM_END = /[\s.,:;!?]/
const EDGE_TRIM_START = /\s/

/**
 * Replaces emails, phone numbers, URLs and common contact handles in free text with [已隐藏].
 * Matching runs on a normalized copy (full-width → half-width, invisible characters dropped,
 * styled digits folded); text outside a match is returned exactly as given.
 */
export function redact(text: string): string {
  const n = normalize(text)

  const ranges: [number, number][] = []
  for (const pattern of PATTERNS) {
    for (const m of n.text.matchAll(pattern)) {
      let s = m.index!
      let e = s + m[0].length
      // Keep the sentence's own punctuation and spacing outside the replacement.
      while (e > s && EDGE_TRIM_END.test(n.text[e - 1]!)) e--
      while (s < e && EDGE_TRIM_START.test(n.text[s]!)) s++
      if (e > s) ranges.push([n.from[s]!, n.to[e - 1]!])
    }
  }
  if (ranges.length === 0) return text

  ranges.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1]
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }

  let out = ''
  let cursor = 0
  for (const [start, end] of merged) {
    out += text.slice(cursor, start) + REDACTED
    cursor = end
  }
  return out + text.slice(cursor)
}
