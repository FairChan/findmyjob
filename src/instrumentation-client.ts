import { init } from '@sentry/nextjs'
import { sentryOptions, beforeBreadcrumb } from './lib/sentry-options'

init({
  ...sentryOptions,
  release: process.env.NEXT_PUBLIC_APP_TAG,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? 'development',
  beforeBreadcrumb,
})
