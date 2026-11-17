import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { env } from '@/env'
import AppHumanCheck from './app-human-check'

// Android App 在 Play Integrity 不可用时（官网直装、无 GMS 手机、未配置）用 WebView 打开这页，
// 拿到 Turnstile token 后通过 ReactNativeWebView.postMessage 交回 App。页面本身不登录、不存任何数据。
export const metadata: Metadata = { title: 'FindMYJob', robots: { index: false, follow: false } }

const ACTIONS = ['login', 'register', 'send-otp', 'forgot-password', 'send-verification'] as const

export default async function AppCheckPage({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  const { action } = await searchParams
  const t = await getTranslations('mobile.auth')
  const safeAction = (ACTIONS as readonly string[]).includes(action ?? '') ? (action as string) : 'login'
  return (
    <main className="flex min-h-dvh items-center justify-center p-6 text-center">
      <AppHumanCheck siteKey={env.TURNSTILE_SITE_KEY} action={safeAction} loadingText={t('humanCheck')} />
    </main>
  )
}
