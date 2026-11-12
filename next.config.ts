import createNextIntlPlugin from 'next-intl/plugin'
import type { NextConfig } from 'next'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  serverExternalPackages: ['pino', '@sentry/nextjs', '@sentry/node', 'pdf-lib', '@pdf-lib/fontkit'],
  outputFileTracingIncludes: {
    '/api/invoices/*/download': ['./assets/fonts/*'],
  },
}

export default withNextIntl(nextConfig)
