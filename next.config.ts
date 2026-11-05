import createNextIntlPlugin from 'next-intl/plugin'
import type { NextConfig } from 'next'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pino', '@sentry/nextjs', '@sentry/node'],
}

export default withNextIntl(nextConfig)
