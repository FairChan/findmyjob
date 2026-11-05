export const REDACTED = '[已隐藏]'

/** Converts full-width ASCII characters to half-width equivalents for regex matching. */
function toHalfWidth(text: string): string {
  return text
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/　/g, ' ')
}

type MatchRange = [number, number]

function collectMatches(text: string, pattern: RegExp): MatchRange[] {
  const ranges: MatchRange[] = []
  const re = new RegExp(
    pattern.source,
    pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g',
  )
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    ranges.push([m.index, m.index + m[0].length])
  }
  return ranges
}

// Patterns ordered so URLs come before emails and emails come before phones.
// No nested variable-length quantifiers to prevent catastrophic backtracking.
const PATTERNS: RegExp[] = [
  // URL (http/https)
  /https?:\/\/[^\s　]+/gi,
  // URL without http(s): www. prefix
  /\bwww\.\S{3,}/gi,
  // URL without http(s): known professional/social domains (require path to avoid tech-name false positives)
  /\b(?:linkedin|github|gitlab)\.com\/\S+|\bt\.me\/\S+/gi,
  // Email
  /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
  // Malaysian phone with +60 country code
  /\+60[\s\-]?1[0-9][\s\-]?\d{3,4}[\s\-]?\d{4}/g,
  // Malaysian phone without country code (01X-…)
  /\b01[0-9][\s\-]?\d{3,4}[\s\-]?\d{4}\b/g,
  // Chinese mobile with +86 country code
  /\+86[\s\-]?1[3-9]\d[\s\-]?\d{4}[\s\-]?\d{4}/g,
  // Chinese mobile without country code (1[3-9]X, 11 digits); lookbehind blocks digits/letters to avoid matching within longer numbers
  /(?<![0-9a-zA-Z])[1][3-9][0-9][\s\-]?\d{4}[\s\-]?\d{4}(?![0-9])/g,
  // Generic international: +CC followed by 7–15 digits (with optional spaces/dashes)
  /\+[1-9]\d{0,2}[\s\-]?\(?\d{1,4}\)?[\s\-]?\d{3,4}[\s\-]?\d{3,4}/g,
  // WeChat and aliases: 微信/微信号/vx/VX/V信/wx/wechat/wechat id
  /(?:微信号?|[vV](?:[xX]|信)|\bwx\b|wechat(?:\s+id)?)\s*[：:＝=]?\s*[a-zA-Z0-9_\-.@]+/gi,
  // QQ number
  /QQ号?\s*[：:＝=]?\s*\d{5,12}/gi,
  // Telegram / TG handle
  /(?:\btelegram\b|\btg\b)\s*[：:＝=]?\s*@[a-zA-Z0-9_]{5,}/gi,
  // Line ID
  /\bline\s+id\s*[：:＝=]?\s*[a-zA-Z0-9_\-.@]+/gi,
  // WhatsApp with phone number (keyword + number captured together)
  /\bwhatsapp\s+\+?[0-9][\d\s\-]{7,15}/gi,
]

/**
 * Replaces emails, phone numbers, URLs, and common contact handle patterns in
 * free text with [已隐藏].  Full-width digits and punctuation are normalised
 * before matching so that patterns written in full-width are caught too;
 * non-sensitive characters are returned as-is.
 */
export function redact(text: string): string {
  const normalized = toHalfWidth(text)

  const rawRanges: MatchRange[] = []
  for (const pattern of PATTERNS) {
    rawRanges.push(...collectMatches(normalized, pattern))
  }

  // Sort and merge overlapping / adjacent ranges.
  rawRanges.sort((a, b) => a[0] - b[0])
  const merged: MatchRange[] = []
  for (const [start, end] of rawRanges) {
    const last = merged[merged.length - 1]
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end)
    } else {
      merged.push([start, end])
    }
  }

  // Replace from right to left so that earlier offsets stay valid.
  let result = text
  for (let i = merged.length - 1; i >= 0; i--) {
    const [start, end] = merged[i]!
    result = result.slice(0, start) + REDACTED + result.slice(end)
  }
  return result
}
