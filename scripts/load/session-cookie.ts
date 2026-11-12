import type { BetterAuthOptions } from 'better-auth'
import { getCookies } from 'better-auth/cookies'
import { makeSignature } from 'better-auth/crypto'

export type LoadSessionOptions = {
  secret: string
  baseURL: string
  advanced?: BetterAuthOptions['advanced']
}

/** Explicit caller configuration only: never load environment files or auth defaults. */
export function requireLoadSessionOptions(input: {
  secret?: string
  baseURL?: string
  advanced?: BetterAuthOptions['advanced']
}): LoadSessionOptions {
  if (typeof input.secret !== 'string' || input.secret.trim().length < 32) {
    throw new Error('Load session secret must be explicitly supplied and contain at least 32 characters')
  }
  if (typeof input.baseURL !== 'string' || !input.baseURL.trim()) {
    throw new Error('Load session baseURL must be explicitly supplied as an absolute HTTP(S) URL')
  }
  let url: URL
  try {
    url = new URL(input.baseURL)
  } catch {
    throw new Error('Load session baseURL must be an absolute HTTP(S) URL')
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || input.baseURL !== input.baseURL.trim()) {
    throw new Error('Load session baseURL must be an absolute HTTP(S) URL')
  }
  return { secret: input.secret, baseURL: input.baseURL, advanced: input.advanced }
}

export async function createLoadSessionCookie(token: string, options: LoadSessionOptions) {
  const validated = requireLoadSessionOptions(options)
  const { name, attributes } = getCookies(validated).sessionToken
  const value = encodeURIComponent(`${token}.${await makeSignature(token, validated.secret)}`)
  return { name, value, attributes, header: `${name}=${value}` }
}
