import { init } from '@sentry/nextjs'
import { sentryOptions } from './lib/sentry-options'

init(sentryOptions)
