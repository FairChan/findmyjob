import { route } from '@/server/route'
import { mobileOk, toIso } from '@/server/lib/mobile-api'
import { listOwnResumes } from '@/server/services/resume-files'
import { mobileResumeListSchema } from '@/shared/mobile-api'

// 本人的简历列表（主简历在前）；不返回存储 key，下载仍走 /api/resumes/:id 的签名 URL
export const GET = route({ auth: 'student', origin: 'app' }, async (_req, ctx) => {
  const rows = await listOwnResumes({ userId: ctx.userId! })
  return mobileOk(mobileResumeListSchema, { items: rows.map((r) => ({ ...r, createdAt: toIso(r.createdAt) })) })
})
