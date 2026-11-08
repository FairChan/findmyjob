import { z } from 'zod'
import { route } from '@/server/route'
import { db } from '@/server/db'
import { isPartnerLogoKey } from '@/server/services/admin-schools-partners'
import { getObjectBytes } from '@/lib/storage'
import { detectFileType, MIME_TYPES } from '@/server/lib/pdf'

const LOGO_MAX_BYTES = 2 * 1024 * 1024

const partnerIdSchema = z.string().cuid()

export const GET = route({ auth: 'public' }, async (req) => {
  const rawId = new URL(req.url).pathname.split('/').slice(-1)[0] ?? ''
  const parsed = partnerIdSchema.safeParse(rawId)
  if (!parsed.success) {
    return new Response(null, { status: 404 })
  }
  const partnerId = parsed.data

  const partner = await db.partner.findUnique({
    where: { id: partnerId },
    select: { logoKey: true },
  })

  if (!partner?.logoKey || !isPartnerLogoKey(partner.logoKey)) {
    return new Response(null, { status: 404 })
  }

  let bytes: Buffer
  try {
    bytes = await getObjectBytes(partner.logoKey, { maxBytes: LOGO_MAX_BYTES })
  } catch {
    return new Response(null, { status: 404 })
  }

  const fileType = detectFileType(bytes)
  if (fileType !== 'png' && fileType !== 'jpeg') {
    return new Response(null, { status: 404 })
  }

  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': MIME_TYPES[fileType],
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=86400',
    },
  })
})
