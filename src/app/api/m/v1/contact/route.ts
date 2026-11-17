import { route } from '@/server/route'
import { mobileOk } from '@/server/lib/mobile-api'
import { getOwnContact, updateContactSchema, updateOwnContact, type UpdateContactInput } from '@/server/services/contact-access'
import { mobileContactSchema } from '@/shared/mobile-api'

// 学生本人的联系方式，只经 contact-access 读写（红线）。读取时解密失败直接报错，
// 不会把读不出来的字段当成 null 返回、再被整份提交时抹掉
export const GET = route({ auth: 'student', origin: 'app' }, async (_req, ctx) => {
  return mobileOk(mobileContactSchema, await getOwnContact({ userId: ctx.userId! }))
})

// 与 Web /s/contact 的表单相同：整份提交，没带的字段会被清空；电话会规范成 E.164
export const PUT = route({ auth: 'student', origin: 'app', input: updateContactSchema }, async (_req, ctx) => {
  const user = { userId: ctx.userId! }
  await updateOwnContact(user, ctx.input as UpdateContactInput)
  return mobileOk(mobileContactSchema, await getOwnContact(user))
})
