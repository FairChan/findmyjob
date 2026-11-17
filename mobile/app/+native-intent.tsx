import { mapIncomingPath } from '@/lib/deep-links'

// Expo Router 在处理外部链接（App Links、自定义 scheme）之前调用：网页路径 → App 路由（MA3-T04）
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return mapIncomingPath(path)
}
