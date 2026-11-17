import { route } from '@/server/route'
import { getMobileConfig } from '@/server/services/mobile-app'

// Android App 启动配置（MA1-T04）：未登录可访问，proxy.ts 已放行；只接受 App origin。
export const GET = route({ auth: 'public', origin: 'app' }, async () => {
  return Response.json({ ok: true, data: await getMobileConfig() })
})
