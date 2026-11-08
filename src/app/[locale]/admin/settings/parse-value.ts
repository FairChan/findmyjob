/**
 * Converts a string input to the appropriate value type for a setting.
 * Empty string for a numeric field is returned as-is so the server zod schema
 * can reject it, preventing accidental storage of 0.
 */
export function parseSettingValue(str: string, defaultValue: unknown): unknown {
  if (typeof defaultValue === 'boolean') {
    return str === 'true'
  }
  if (Array.isArray(defaultValue)) {
    return str.split(',').map((x) => {
      const n = Number(x.trim())
      return Number.isNaN(n) ? x.trim() : n
    })
  }
  if (typeof defaultValue === 'number') {
    const trimmed = str.trim()
    if (trimmed === '') return trimmed
    const n = Number(trimmed)
    return Number.isNaN(n) ? trimmed : n
  }
  return str.trim()
}
