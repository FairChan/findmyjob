/** 后台输入的薪资档："3000, 2000 5000" → [2000, 3000, 5000]；有非法项或为空时返回 null，不保存 */
export function parseBands(input: string): number[] | null {
  const parts = input.split(/[\s,，]+/).filter(Boolean)
  if (!parts.length || parts.some((p) => !/^\d+$/.test(p) || Number(p) <= 0)) return null
  return [...new Set(parts.map(Number))].sort((a, b) => a - b)
}
