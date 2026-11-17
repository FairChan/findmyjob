// Accepts only a same-origin, locale-prefixed path such as "/zh/admin" or "/en/s/jobs/abc".
// Anything else (absolute URLs, protocol-relative "//", backslashes, encoded tricks) is dropped.
const RETURN_PATH = /^\/(zh|en)(\/[A-Za-z0-9._~-]+)*\/?$/

export function safeReturnPath(raw: string | string[] | undefined, locale: string): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value || !RETURN_PATH.test(value)) return null
  if (!value.startsWith(`/${locale}`)) return null
  if (value.includes('/legal/reconsent')) return null
  return value
}
