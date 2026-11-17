'use client'
import TurnstileWidget from '@/components/auth/TurnstileWidget'

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (message: string) => void }
  }
}

function post(message: { type: 'turnstile'; token: string } | { type: 'turnstile-error' }) {
  // 只在 App 的 WebView 里有这个桥；普通浏览器打开这页什么也不会发生
  window.ReactNativeWebView?.postMessage(JSON.stringify(message))
}

export default function AppHumanCheck({ siteKey, action, loadingText }: { siteKey: string; action: string; loadingText: string }) {
  return (
    <div className="space-y-4">
      <p role="status" className="text-sm text-muted-foreground">
        {loadingText}
      </p>
      <TurnstileWidget
        siteKey={siteKey}
        action={action}
        onToken={(token) => post({ type: 'turnstile', token })}
        onError={() => post({ type: 'turnstile-error' })}
      />
    </div>
  )
}
