import { z } from 'zod'
import { route } from '@/server/route'
import { getSignedDownloadUrl } from '@/lib/storage'
import { db } from '@/server/db'

const idSchema = z.string().cuid()

export const GET = route({ auth: 'student' }, async (req, ctx) => {
  const userId = ctx.userId!

  const rawId = new URL(req.url).pathname.split('/').pop() ?? ''
  const parsedId = idSchema.safeParse(rawId)
  if (!parsedId.success) {
    return new Response(JSON.stringify({ ok: false, code: 'NOT_FOUND' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
    })
  }
  const id = parsedId.data

  const resume = await db.resumeFile.findUnique({
    where: { id },
    select: { id: true, storageKey: true, fileName: true, student: { select: { userId: true } } },
  })

  if (!resume || resume.student.userId !== userId) {
    return new Response(JSON.stringify({ ok: false, code: 'NOT_FOUND' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
    })
  }

  const url = await getSignedDownloadUrl(resume.storageKey, resume.fileName)

  return Response.redirect(url, 302)
})
