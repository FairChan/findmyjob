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
const PATTERNS: RegExp[] = [
  // URL (http/https)
  /https?:\/\/[^\s　]+/gi,
  // Email
  /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
  // Malaysian phone with +60 country code
  /\+60[\s\-]?1[0-9][\s\-]?\d{3,4}[\s\-]?\d{4}/g,
  // Malaysian phone without country code (01X-…)
  /\b01[0-9][\s\-]?\d{3,4}[\s\-]?\d{4}\b/g,
  // Chinese mobile with +86 country code
  /\+86[\s\-]?1[3-9]\d[\s\-]?\d{4}[\s\-]?\d{4}/g,
  // Generic international: +CC followed by 7–15 digits (with optional spaces/dashes)
  /\+[1-9]\d{0,2}[\s\-]?\(?\d{1,4}\)?[\s\-]?\d{3,4}[\s\-]?\d{3,4}/g,
  // WeChat: "微信"/"WeChat"/"wx" (word-bounded) followed by optional delimiter and account
  /(?:微信|WeChat|\bwx\b)\s*[：:＝=]?\s*[a-zA-Z0-9_\-.@]+/g,
]

/**
 * Replaces emails, phone numbers, URLs, and WeChat handles in free text with [已隐藏].
 * Full-width digits and punctuation are normalised before matching so that patterns
 * written in full-width are caught too; non-sensitive characters are returned as-is.
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
