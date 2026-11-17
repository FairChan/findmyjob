import { describe, expect, it } from 'vitest'
import { verificationEmailContent } from '@/server/lib/verification-email'

describe('verificationEmailContent', () => {
  const url = 'http://localhost:3000/api/auth/verify-email?token=abc&callbackURL=%2Fzh%2Flogin%3Fverified%3D1'

  it('is bilingual and states the expiry', () => {
    const mail = verificationEmailContent(url)
    expect(mail.subject).toMatch(/验证/)
    expect(mail.subject).toMatch(/Verify/)
    expect(mail.text).toContain('1 小时')
    expect(mail.text).toContain('1 hour')
    expect(mail.text).toContain(url)
  })

  it('keeps the link usable in HTML (E2E helpers read href="...verify-email...")', () => {
    const { html } = verificationEmailContent(url)
    const match = html.match(/href="([^"]*verify-email[^"]*)"/)
    expect(match?.[1].replace(/&amp;/g, '&')).toBe(url)
  })

  it('escapes characters that would break out of the attribute', () => {
    expect(verificationEmailContent('https://x.test/?a="><script>').html).not.toContain('"><script>')
  })
})
