export function matchingErrorKey(code: string) {
  if (code === 'FORBIDDEN') return 'error.forbidden'
  if (code === 'VERSION_MISMATCH') return 'error.version'
  if (code === 'CONFLICT') return 'error.conflict'
  if (code === 'NOT_FOUND') return 'error.missing'
  if (code === 'RATE_LIMITED') return 'error.rateLimited'
  if (code === 'VALIDATION_ERROR') return 'error.invalid'
  if (code === 'FEATURE_DISABLED') return 'unavailable'
  return 'error.generic'
}
