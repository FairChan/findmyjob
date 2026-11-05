const COMPOUND_SURNAMES = [
  '欧阳',
  '司马',
  '诸葛',
  '上官',
  '东方',
  '皇甫',
  '尉迟',
  '公孙',
  '慕容',
  '长孙',
  '令狐',
  '夏侯',
]

function isCjk(char: string): boolean {
  const cp = char.codePointAt(0) ?? 0
  return cp >= 0x4e00 && cp <= 0x9fff
}

/**
 * Returns a privacy-safe display name:
 * - Chinese: compound surname (12 supported, only when name ≥ 3 chars) or first character + "同学"
 * - Non-Chinese: first letter (uppercased) + "."
 * Uses code-point iteration so supplementary characters (e.g. U+20000+) are handled correctly.
 */
export function maskName(fullName: string): string {
  if (!fullName) return ''

  const chars = [...fullName]

  // Compound surname only applies when the full name has at least 3 characters
  if (chars.length >= 3) {
    for (const surname of COMPOUND_SURNAMES) {
      if (fullName.startsWith(surname)) {
        return surname + '同学'
      }
    }
  }

  const first = chars[0]!
  if (isCjk(first)) {
    return first + '同学'
  }

  return first.toUpperCase() + '.'
}
