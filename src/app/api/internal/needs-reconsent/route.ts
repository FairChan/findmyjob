import { route } from '@/server/route'
import { needsReconsent } from '@/server/services/legal-consent'

// Called by the middleware (proxy.ts) to check whether the logged-in user needs to
// re-consent to the current legal version (PDPA requirement). Returns quickly so the
// middleware overhead is bounded by the DB round-trip.
export const GET = route({ auth: 'user' }, async (req, { userId }) => {
  const result = await needsReconsent(userId!)
  return new Response(JSON.stringify({ needsReconsent: result }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
