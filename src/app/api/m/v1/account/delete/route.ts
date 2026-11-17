import { route } from '@/server/route'
import { mobileOk } from '@/server/lib/mobile-api'
import { requestDeletion } from '@/server/services/data-rights'
import { mobileAccountDeleteSchema, mobileEmptySchema } from '@/shared/mobile-api'

// 注销账号：与 Web 同一个 service（标记 DELETED、隐藏档案、吊销全部会话、写 data.delete 审计）。
// 会话随之失效，App 收到 200 后要清空 SecureStore 和查询缓存
export const POST = route({ auth: 'student', origin: 'app', input: mobileAccountDeleteSchema }, async (_req, ctx) => {
  await requestDeletion({ userId: ctx.userId! })
  return mobileOk(mobileEmptySchema, {})
})
