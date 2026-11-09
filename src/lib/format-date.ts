/**
 * Format a date in Asia/Kuala_Lumpur timezone.
 * Always formats on the server so the rendered date matches KL time regardless
 * of browser timezone, preventing hydration mismatches.
 */
export function formatKLDate(date: Date | string, locale: string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-Hans-MY' : 'en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(d)
}

/** Format an audit timestamp in KL time, retaining seconds and a 00–23 hour. */
export function formatKLDateTime(date: Date | string, locale: string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const time = new Intl.DateTimeFormat(locale === 'zh' ? 'zh-Hans-MY' : 'en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(d)
  return `${formatKLDate(d, locale)}${locale === 'zh' ? ' ' : ', '}${time}`
}
