import { createRequire } from 'node:module'
import { resolve } from 'node:path'

// Resolve Better Auth's own dependency so tests use the same TOTP implementation
// without making a transitive package a new application dependency.
const projectRequire = createRequire(resolve(process.cwd(), 'package.json'))
const betterAuthRequire = createRequire(projectRequire.resolve('better-auth'))
const { createOTP } = betterAuthRequire('@better-auth/utils/otp') as {
  createOTP(secret: Uint8Array, options: { digits: number; period: number }): {
    totp(): Promise<string>
  }
}
const { base32 } = betterAuthRequire('@better-auth/utils/base32') as {
  base32: { decode(value: string): Uint8Array }
}

export async function totpCode(totpURI: string): Promise<string> {
  const uri = new URL(totpURI)
  const encodedSecret = uri.searchParams.get('secret')
  if (uri.protocol !== 'otpauth:' || uri.hostname !== 'totp' || !encodedSecret) {
    throw new Error('Expected a TOTP setup URI')
  }
  return createOTP(base32.decode(encodedSecret), {
    digits: Number(uri.searchParams.get('digits') ?? 6),
    period: Number(uri.searchParams.get('period') ?? 30),
  }).totp()
}
