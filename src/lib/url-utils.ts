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
