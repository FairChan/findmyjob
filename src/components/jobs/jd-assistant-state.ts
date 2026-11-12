export interface JdSuggestion { zh: string; en: string }

export type JdAssistantErrorKey =
  | 'errorInput' | 'errorOutput' | 'errorTotal' | 'errorForbidden' | 'errorDisabled'
  | 'errorVersion' | 'errorRateLimited' | 'errorGeneric' | 'confirmationChanged'

/** Client display guard only. The service remains responsible for authoritative redaction. */
export function readJdSuggestion(value: unknown): JdSuggestion | null {
  if (value === null || typeof value !== 'object') return null
  const { zh, en } = value as Record<string, unknown>
  if (typeof zh !== 'string' || typeof en !== 'string' || zh.length > 4000 || en.length > 4000) return null
  if (!zh.trim() || !en.trim()) return null
  return { zh: zh.trim(), en: en.trim() }
}

export function combineJdDescription(
  value: JdSuggestion,
  headings: { zh: string; en: string },
): { ok: true; text: string } | { ok: false; error: JdAssistantErrorKey } {
  const suggestion = readJdSuggestion(value)
  if (!suggestion) return { ok: false, error: 'errorOutput' }
  const text = `${headings.zh}\n${suggestion.zh}\n\n${headings.en}\n${suggestion.en}`
  return text.length <= 10000 ? { ok: true, text } : { ok: false, error: 'errorTotal' }
}

export function jdErrorMessage(code: string): JdAssistantErrorKey {
  switch (code) {
    case 'UNAUTHORIZED': case 'FORBIDDEN': return 'errorForbidden'
    case 'FEATURE_DISABLED': return 'errorDisabled'
    case 'VERSION_MISMATCH': return 'errorVersion'
    case 'RATE_LIMITED': return 'errorRateLimited'
    case 'VALIDATION_ERROR': return 'errorInput'
    case 'AI_OUTPUT_INVALID': return 'errorOutput'
    default: return 'errorGeneric'
  }
}
