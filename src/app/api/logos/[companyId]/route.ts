import { z } from 'zod'
import { route } from '@/server/route'
import { db } from '@/server/db'
import { isOwnLogoKey } from '@/server/services/company'
import { getObjectBytes } from '@/lib/storage'
import { detectFileType, MIME_TYPES } from '@/server/lib/pdf'

const LOGO_MAX_BYTES = 2 * 1024 * 1024

const companyIdSchema = z.string().cuid()

export const GET = route({ auth: 'public' }, async (req) => {
  const rawId = new URL(req.url).pathname.split('/').slice(-1)[0] ?? ''
  const parsed = companyIdSchema.safeParse(rawId)
  if (!parsed.success) {
    return new Response(null, { status: 404 })
  }
  const companyId = parsed.data

  const company = await db.company.findUnique({
    where: { id: companyId, verificationStatus: 'VERIFIED', isActive: true },
    select: { logoKey: true },
  })

  if (!company?.logoKey || !isOwnLogoKey(companyId, company.logoKey)) {
    return new Response(null, { status: 404 })
  }

  let bytes: Buffer
  try {
    bytes = await getObjectBytes(company.logoKey, { maxBytes: LOGO_MAX_BYTES })
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
