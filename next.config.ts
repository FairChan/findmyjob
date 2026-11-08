import createNextIntlPlugin from 'next-intl/plugin'
import type { NextConfig } from 'next'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

// Initial report-only CSP to surface violations before switching to enforcement (M7-T15).
// No nonce — enforcement mode with nonce is added in M7-T15.
const CSP_REPORT_ONLY =
  "default-src 'self'; " +
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
  "style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; " +
  "font-src 'self'; " +
  "connect-src 'self'; " +
  "frame-src challenges.cloudflare.com; " +
  "form-action 'self'; " +
  "base-uri 'self'; " +
  "report-uri /api/csp-report"

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  serverExternalPackages: ['pino', '@sentry/nextjs', '@sentry/node', 'pdf-lib'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy-Report-Only',
            value: CSP_REPORT_ONLY,
          },
        ],
      },
    ]
  },
}

export default withNextIntl(nextConfig)
