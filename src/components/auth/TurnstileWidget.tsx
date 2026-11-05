'use client'
import { useEffect, useRef } from 'react'

interface Props {
  siteKey: string
  action: string
  onToken: (token: string) => void
  onExpire?: () => void
  /** 脚本加载失败或挑战出错时调用；组件自己会在 3 秒后重试一次挑战 */
  onError?: () => void
}

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string
          action?: string
          callback?: (token: string) => void
          'expired-callback'?: () => void
          'error-callback'?: () => boolean | void
          theme?: 'light' | 'dark' | 'auto'
          size?: 'normal' | 'compact' | 'flexible' | 'invisible'
        },
      ) => string
      reset: (widgetId: string) => void
      remove: (widgetId: string) => void
    }
    onloadTurnstileCallback?: () => void
  }
}

export default function TurnstileWidget({ siteKey, action, onToken, onExpire, onError }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)

  useEffect(() => {
    const renderWidget = () => {
      if (!containerRef.current || !window.turnstile) return
      if (widgetIdRef.current) return

      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action,
        size: 'invisible',
        callback: onToken,
        'expired-callback': onExpire,
        // 出错时不要让用户卡在「正在验证」：报给表单，并重试一次挑战
        'error-callback': () => {
          onError?.()
          const id = widgetIdRef.current
          setTimeout(() => {
            if (id && widgetIdRef.current === id) window.turnstile?.reset(id)
          }, 3000)
          return true
        },
      })
    }

    if (window.turnstile) {
      renderWidget()
    } else {
      const scriptId = 'cf-turnstile-script'
      if (!document.getElementById(scriptId)) {
        const script = document.createElement('script')
        script.id = scriptId
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onloadTurnstileCallback'
        script.async = true
        script.defer = true
        script.onerror = () => onError?.()
        document.head.appendChild(script)
      }
      window.onloadTurnstileCallback = renderWidget
    }

    // Always clean up on unmount or dependency change to prevent stale callbacks
    // from firing into a remounted component's state.
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
  }, [siteKey, action, onToken, onExpire, onError])

  return <div ref={containerRef} />
}
