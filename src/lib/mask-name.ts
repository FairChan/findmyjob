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
 * - Chinese: compound surname (12 supported) or first character + "同学"
 * - Non-Chinese: first letter (uppercased) + "."
 */
export function maskName(fullName: string): string {
  if (!fullName) return ''

  for (const surname of COMPOUND_SURNAMES) {
    if (fullName.startsWith(surname)) {
      return surname + '同学'
    }
  }

  const first = fullName[0]!
  if (isCjk(first)) {
    return first + '同学'
  }

  return first.toUpperCase() + '.'
}
