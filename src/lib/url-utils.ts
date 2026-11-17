/**
 * Returns the URL only if the protocol is http or https.
 * Prevents javascript:, data:, and other dangerous protocols from appearing in links.
 */
export function safeWebsiteHref(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return url
    }
    return null
  } catch {
    return null
  }
}

/**
 * Accepts what people actually type into a "website" box ("abc.com.my", "www.abc.com") by
 * assuming https:// when no scheme is given. Anything with a scheme is left untouched so
 * validation can still reject javascript:, ftp: and the like.
 */
export function normalizeWebsiteInput(raw: string | null | undefined): string | undefined {
  const value = raw?.trim()
  if (!value) return undefined
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^[^/:]+:\d+(\/|$)/.test(value)) return value
  return `https://${value.replace(/^\/+/, '')}`
}
