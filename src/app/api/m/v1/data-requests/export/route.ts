import { route } from '@/server/route'
import { mobileOk } from '@/server/lib/mobile-api'
import { requestExport } from '@/server/services/data-rights'
import { mobileDataExportSchema, mobileEmptyInputSchema } from '@/shared/mobile-api'

// 数据导出申请（24 小时内去重）；导出包由后台任务生成，下载仍在 Web 隐私中心，App 不缓存导出包
export const POST = route({ auth: 'student', origin: 'app', input: mobileEmptyInputSchema }, async (_req, ctx) => {
  return mobileOk(mobileDataExportSchema, await requestExport({ userId: ctx.userId! }))
})
