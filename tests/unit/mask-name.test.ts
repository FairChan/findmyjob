import { describe, it, expect } from 'vitest'
import { maskName } from '@/lib/mask-name'

describe('maskName – Chinese single surname', () => {
  it('李明 → 李同学', () => expect(maskName('李明')).toBe('李同学'))
  it('张三丰 → 张同学', () => expect(maskName('张三丰')).toBe('张同学'))
  it('陈 (single char) → 陈同学', () => expect(maskName('陈')).toBe('陈同学'))
  it('王芳芳 → 王同学', () => expect(maskName('王芳芳')).toBe('王同学'))
})

describe('maskName – compound surnames', () => {
  it('欧阳修 → 欧阳同学', () => expect(maskName('欧阳修')).toBe('欧阳同学'))
  it('司马光 → 司马同学', () => expect(maskName('司马光')).toBe('司马同学'))
  it('诸葛亮 → 诸葛同学', () => expect(maskName('诸葛亮')).toBe('诸葛同学'))
  it('上官仪 → 上官同学', () => expect(maskName('上官仪')).toBe('上官同学'))
  it('东方朔 → 东方同学', () => expect(maskName('东方朔')).toBe('东方同学'))
  it('皇甫谧 → 皇甫同学', () => expect(maskName('皇甫谧')).toBe('皇甫同学'))
  it('尉迟恭 → 尉迟同学', () => expect(maskName('尉迟恭')).toBe('尉迟同学'))
  it('公孙龙 → 公孙同学', () => expect(maskName('公孙龙')).toBe('公孙同学'))
  it('慕容复 → 慕容同学', () => expect(maskName('慕容复')).toBe('慕容同学'))
  it('长孙无忌 → 长孙同学', () => expect(maskName('长孙无忌')).toBe('长孙同学'))
  it('令狐冲 → 令狐同学', () => expect(maskName('令狐冲')).toBe('令狐同学'))
  it('夏侯惇 → 夏侯同学', () => expect(maskName('夏侯惇')).toBe('夏侯同学'))
})

describe('maskName – non-Chinese names', () => {
  it('John Doe → J.', () => expect(maskName('John Doe')).toBe('J.'))
  it('alice → A.', () => expect(maskName('alice')).toBe('A.'))
  it('Muhammad bin Ali → M.', () => expect(maskName('Muhammad bin Ali')).toBe('M.'))
  it('Tan Wei Ming → T.', () => expect(maskName('Tan Wei Ming')).toBe('T.'))
})

describe('maskName – edge cases', () => {
  it('empty string returns empty string', () => expect(maskName('')).toBe(''))
  // 2-char compound surname: treated as single-char surname (compound rule requires ≥ 3 chars)
  it('夏侯 (2-char compound alone) → 夏同学', () => expect(maskName('夏侯')).toBe('夏同学'))
  it('欧阳 (2-char compound alone) → 欧同学', () => expect(maskName('欧阳')).toBe('欧同学'))
  it('single char non-CJK returns uppercase + .', () => expect(maskName('z')).toBe('Z.'))
})

describe('maskName – compound surname requires ≥ 3 chars', () => {
  it('东方明 (3 chars, compound surname) → 东方同学', () => expect(maskName('东方明')).toBe('东方同学'))
  it('欧阳明明 (4 chars, compound surname) → 欧阳同学', () => expect(maskName('欧阳明明')).toBe('欧阳同学'))
})

describe('maskName – supplementary characters (no isolated surrogates)', () => {
  it('𠀀明 uses code-point-safe first char', () => {
    const result = maskName('𠀀明')
    // Must not contain isolated surrogates (U+D800–U+DFFF as lone code units)
    expect(result).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
    expect(result).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/)
  })
})
