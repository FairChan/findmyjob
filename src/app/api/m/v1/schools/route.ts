import { route } from '@/server/route'
import { mobileOk } from '@/server/lib/mobile-api'
import { listMobileSchools } from '@/server/services/mobile-student'
import { mobileSchoolListSchema } from '@/shared/mobile-api'

// 建档和学校认证的下拉选项；与 Web 的 listActiveSchoolsAction 一样只对学生开放
export const GET = route({ auth: 'student', origin: 'app' }, async () => {
  return mobileOk(mobileSchoolListSchema, await listMobileSchools())
})
