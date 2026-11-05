export const REDACTED = '[已隐藏]'

// Characters that render as nothing; students (or copy-paste) can hide them inside numbers.
const INVISIBLE = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x00ad])
// Look-alikes that a Chinese IME or a font picker produces instead of ASCII punctuation.
const AS_DOT = new Set([0x3002, 0xff61, 0xfe52]) // 。 ｡ ﹒
const AS_AT = new Set([0xfe6b]) // ﹫
const NON_ASCII_DIGIT = /\p{Nd}/u

interface Normalized {
  text: string
  /** For each UTF-16 unit of `text`: [start, end) of the source code point in the input. */
  from: number[]
  to: number[]
}

/**
 * Builds the string the patterns run on, one code point at a time, and remembers where each
 * output unit came from. Matching happens on the normalized text; replacement happens on the
 * original, so anything outside a match is returned byte-for-byte.
 */
function normalize(input: string): Normalized {
  let text = ''
  const from: number[] = []
  const to: number[] = []
  for (let i = 0; i < input.length; ) {
    const cp = input.codePointAt(i)!
    const width = cp > 0xffff ? 2 : 1
    let out: string
    if (INVISIBLE.has(cp)) out = ''
    else if (cp >= 0xff01 && cp <= 0xff5e) out = String.fromCharCode(cp - 0xfee0)
    else if (cp === 0x3000) out = ' '
    else if (AS_DOT.has(cp)) out = '.'
    else if (AS_AT.has(cp)) out = '@'
    else {
      out = input.slice(i, i + width)
      if (cp > 0x7f && NON_ASCII_DIGIT.test(out)) {
        // Mathematical / styled digits fold to ASCII under NFKC; scripts like Arabic-Indic do not.
        const folded = out.normalize('NFKC')
        if (/^[0-9]$/.test(folded)) out = folded
      }
    }
    for (let k = 0; k < out.length; k++) {
      from.push(i)
      to.push(i + width)
    }
    text += out
    i += width
  }
  return { text, from, to }
}

// Phone separators: whitespace, ASCII/Unicode dashes, dots, slashes, parentheses — up to three.
const SEP = String.raw`[\s\-‐-―./()]{0,3}`
const MAIL_PROVIDERS = String.raw`(?:gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me|qq|foxmail|163|126|yeah|sina|sohu|aliyun|proton(?:mail)?)`
const DOMAIN = String.raw`[A-Za-z0-9\-]{1,63}(?:\.[A-Za-z0-9\-]{1,63}){0,10}\.[A-Za-z]{2,24}`
// The look-behind pins each attempt to the start of a run, so the unbounded `+` stays linear;
// a length cap here would let "-----…alice@gmail.com" (64+ chars) slip through.
const LOCAL = String.raw`(?:(?<![A-Za-z0-9._%+\-])[A-Za-z0-9._%+\-]+|\p{Script=Han}{1,6})`
const WECHAT_KEYWORD = String.raw`(?:微信号?|威信|[vV](?:[xX]|信)|\bwx\b|\bwechat(?:\s*id)?\b|\bweixin\b)`
const OPEN_BRACKET = String.raw`[(\[【「《<]?`
// Words that follow "WeChat" in résumés without being an account name.
const WECHAT_PRODUCT_WORDS = String.raw`(?:pay(?:ments?)?|mini(?:-?programs?)?|programs?|official|accounts?|work|moments|channels?|stores?|groups?|api|sdk|apps?|open|platforms?|develop(?:er|ers|ment)?|marketing|ecosystem|integration|login|oauth|cloud|search|ads|wallet|merchants?|services?|support|users?|e-?commerce)\b`
// A URL ends at whitespace or sentence punctuation; non-ASCII path segments (/in/王明-…) stay inside.
const URL_TAIL = String.raw`[^\s,;!"'<>、】」》』]`

// Every quantifier is bounded and every pattern is anchored by a literal or a look-behind, so
// matching stays linear on long free text (100k chars well under 50ms).
const PATTERNS: RegExp[] = [
  // URLs with a scheme, then scheme-less forms that carry a contact on their own
  new RegExp(String.raw`https?:\/\/${URL_TAIL}{1,2048}`, 'giu'),
  new RegExp(String.raw`\bwww\.${URL_TAIL}{3,2048}`, 'giu'),
  new RegExp(String.raw`\b(?:linkedin|github|gitlab)\.com\/${URL_TAIL}{1,2048}`, 'giu'),
  new RegExp(String.raw`\b(?:t\.me|wa\.me|wa\.link)\/${URL_TAIL}{1,2048}`, 'giu'),
  new RegExp(String.raw`\b(?:api\.)?whatsapp\.com\/${URL_TAIL}{1,2048}`, 'giu'),

  // Email, including spaces around @, (at)/[at], a Han local part, and "x at gmail dot com"
  new RegExp(String.raw`${LOCAL}\s{0,2}@\s{0,2}${DOMAIN}`, 'gu'),
  new RegExp(String.raw`${LOCAL}\s{0,2}[(\[]\s{0,2}at\s{0,2}[)\]]\s{0,2}${DOMAIN}`, 'giu'),
  new RegExp(
    String.raw`(?<![A-Za-z0-9._%+\-])[A-Za-z0-9._%+\-]+\s{1,3}at\s{1,3}${MAIL_PROVIDERS}\s{1,3}dot\s{1,3}(?:com|net|org|cn|my|edu)\b`,
    'gi',
  ),

  // Malaysia: +60 / (+60) / 60 / 0 then 1x, with flexible separators
  new RegExp(String.raw`(?<![0-9])(?:\(\s?\+?\s?60\s?\)|\+?\s?60)${SEP}1[0-9]${SEP}\d{3,4}${SEP}\d{4}(?![0-9])`, 'g'),
  new RegExp(String.raw`(?<![0-9])\(?01[0-9]\)?${SEP}\d{3,4}${SEP}\d{4}(?![0-9])`, 'g'),
  // Mainland China mobile, with or without +86
  new RegExp(String.raw`(?<![0-9])(?:\(?\+?\s?86\)?${SEP})?1[3-9][0-9]${SEP}\d{4}${SEP}\d{4}(?![0-9])`, 'g'),
  // Any other +CC number
  new RegExp(String.raw`\+[1-9]\d{0,2}${SEP}\(?\d{1,4}\)?${SEP}\d{3,4}${SEP}\d{3,4}(?![0-9])`, 'g'),

  // WeChat with an explicit connector (：/=/-/是/为/is/…) or bracket: any handle-like token
  new RegExp(
    String.raw`${WECHAT_KEYWORD}\s{0,3}(?:号码?\s{0,3})?(?:[:=\-–—→/]|是|为|is\b|id\b)\s{0,3}${OPEN_BRACKET}\s{0,3}[A-Za-z0-9][A-Za-z0-9_.\-]{2,29}`,
    'gi',
  ),
  // WeChat without a connector: a token with a digit or underscore, or a letters-first token of
  // 6+ chars that is not a product word — so "微信 alicewong" is hidden but "WeChat Pay",
  // "WeChat mini-program", "WeChat development" stay as written
  new RegExp(
    String.raw`${WECHAT_KEYWORD}\s{0,3}${OPEN_BRACKET}\s{0,3}(?:(?=[A-Za-z0-9_.\-]{0,29}[0-9_])[A-Za-z0-9][A-Za-z0-9_.\-]{2,29}|(?!${WECHAT_PRODUCT_WORDS})[A-Za-z][A-Za-z0-9_.\-]{5,29})`,
    'gi',
  ),

  // Other handles
  /QQ\s{0,3}号?\s{0,3}(?:[:=]|是|为)?\s{0,3}\d{5,12}/gi,
  /(?:\btelegram\b|\btg\b)\s{0,3}(?:[:=]|is\b)?\s{0,3}@[a-zA-Z0-9_]{5,32}/gi,
  /\bline\s{1,3}id\s{0,3}[:=]?\s{0,3}[a-zA-Z0-9_\-.@]{1,30}/gi,
  /\bwhats\s?app\b\s{0,3}(?:[:=]|is\b)?\s{0,3}\+?[0-9][\d\s\-]{7,15}/gi,
]

/**
 * Replaces emails, phone numbers, URLs and common contact handles in free text with [已隐藏].
 * Matching runs on a normalized copy (full-width → half-width, invisible characters dropped,
 * styled digits folded); text outside a match is returned exactly as given.
 */
export function redact(text: string): string {
  const n = normalize(text)

  const ranges: [number, number][] = []
  for (const pattern of PATTERNS) {
    pattern.lastIndex = 0
    for (const m of n.text.matchAll(pattern)) {
      if (m[0].length === 0) continue
      const s = m.index!
      ranges.push([n.from[s]!, n.to[s + m[0].length - 1]!])
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
