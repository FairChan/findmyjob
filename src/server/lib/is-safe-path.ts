// Anchored regex: only /(zh|en)/jobs/<cuid> — no extra segments, query, fragment,
// protocol, host, double-slash, or backslash. Decoded once; reject if re-encoding changes it.
const JOB_DETAIL_PATH_RE = /^\/(zh|en)\/jobs\/[a-z][a-z0-9]{20,}$/

export function isSafePath(path: string, role: string, locale: string): boolean {
  if (!path.startsWith('/')) return false
  // Prevent protocol-relative and backslash bypasses
  if (path.startsWith('//') || path.includes('\\')) return false

  // Decode once to catch %2F, %2E etc.
  let decoded: string
  try {
    decoded = decodeURIComponent(path)
  } catch {
    return false
  }
  // Reject if the original path contained encoded characters (e.g. %2F, %2E)
  if (decoded !== path) return false

  // Allow any role to return to a job detail page
  if (JOB_DETAIL_PATH_RE.test(path)) return true

  if (role === 'STUDENT') return path.startsWith(`/${locale}/s/`)
  if (role === 'EMPLOYER') return path.startsWith(`/${locale}/e/`)
  if (role === 'ADMIN') return path.startsWith(`/${locale}/admin/`) || path === `/${locale}/admin`
  return false
}
