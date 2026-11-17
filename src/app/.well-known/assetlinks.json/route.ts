import { route } from '@/server/route'
import { androidAssetLinks } from '@/server/lib/android-app-links'

// Android App Links（MA3-T04）：声明 findmyjob.asia 的链接可以由我们签名的 App 直接打开。
// 公开、可缓存；没配置时返回空数组（App 不会接管链接，网页照常打开）。
export const GET = route({ auth: 'public' }, async () => {
  return new Response(JSON.stringify(androidAssetLinks(process.env.ANDROID_APP_LINKS)), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
  })
})
