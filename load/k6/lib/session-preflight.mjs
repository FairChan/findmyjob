/** Read-only transport recovery; resolves only after exact session validation. */
export async function verifySessionPreflight({ request, pause, onRetry, url, cookie, userId, role }) {
  const params = { headers: { Cookie: cookie }, redirects: 0, timeout: '5s', tags: { name: 'session_preflight' } }
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await request('GET', url, null, params)
    if (response.status === 0) {
      if (attempt === 2) throw new Error('Session preflight transport exhausted (HTTP 0)')
      onRetry()
      await pause(100 * (attempt + 1))
      continue
    }
    if (response.status !== 200) throw new Error(`Session preflight rejected synthetic user/role (HTTP ${response.status})`)
    let session
    try { session = response.json() } catch { throw new Error('Session preflight rejected malformed JSON (HTTP 200)') }
    if (session?.user?.id !== userId || session?.user?.role !== role) throw new Error('Session preflight rejected synthetic user/role (HTTP 200)')
    return
  }
}
