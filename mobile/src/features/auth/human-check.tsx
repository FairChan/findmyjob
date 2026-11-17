import * as AppIntegrity from '@expo/app-integrity'
import { playIntegrityHashInput, type HumanCheckAction } from '@shared/mobile-api'
import Constants from 'expo-constants'
import * as Crypto from 'expo-crypto'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { Modal, Platform, StyleSheet, View } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import { useLocale, useTranslations } from 'use-intl'

import { Button } from '@/components/ui'
import { apiBaseUrl } from '@/lib/api-config'
import { useTheme } from '@/theme/use-theme'

/** 认证请求要带的人机校验字段：Play 正版走 Integrity，其余（直装 APK、无 GMS、未配置）走 Turnstile */
export type HumanProof = { integrityToken: string } | { turnstileToken: string }

let integrityReady: Promise<void> | null = null

function integrityProjectNumber(): string | null {
  const extra = Constants.expoConfig?.extra as { playIntegrityProjectNumber?: string } | undefined
  return extra?.playIntegrityProjectNumber || null
}

/** base64 → base64url，和服务端 digest('base64url') 一致 */
export function toBase64Url(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function integrityRequestHash(action: HumanCheckAction, email: string): Promise<string> {
  const b64 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, playIntegrityHashInput(action, email), {
    encoding: Crypto.CryptoEncoding.BASE64,
  })
  return toBase64Url(b64)
}

/** 拿 Play Integrity token；拿不到返回 null（调用方改走 Turnstile） */
export async function tryIntegrityToken(action: HumanCheckAction, email: string): Promise<string | null> {
  const project = integrityProjectNumber()
  if (Platform.OS !== 'android' || !project) return null
  try {
    integrityReady ??= AppIntegrity.prepareIntegrityTokenProviderAsync(project)
    await integrityReady
    return await AppIntegrity.requestIntegrityCheckAsync(await integrityRequestHash(action, email))
  } catch {
    integrityReady = null
    return null
  }
}

type Pending = { action: HumanCheckAction; resolve: (token: string) => void; reject: (err: Error) => void }

const HumanCheckContext = createContext<(action: HumanCheckAction, email: string, opts?: { forceTurnstile?: boolean }) => Promise<HumanProof>>(
  async () => {
    throw new Error('HumanCheckProvider missing')
  },
)

export function useHumanCheck() {
  return useContext(HumanCheckContext)
}

/** 提供 requestProof()；需要 Turnstile 时弹出 WebView 打开网页版的 /app-check */
export function HumanCheckProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const pendingRef = useRef<Pending | null>(null)
  const locale = useLocale()
  const t = useTranslations('mobile.common')
  const { colors } = useTheme()

  const finish = useCallback((fn: (p: Pending) => void) => {
    const p = pendingRef.current
    pendingRef.current = null
    setPending(null)
    if (p) fn(p)
  }, [])

  const requestProof = useCallback(
    async (action: HumanCheckAction, email: string, opts?: { forceTurnstile?: boolean }): Promise<HumanProof> => {
      if (!opts?.forceTurnstile) {
        const integrityToken = await tryIntegrityToken(action, email)
        if (integrityToken) return { integrityToken }
      }
      const turnstileToken = await new Promise<string>((resolve, reject) => {
        const p = { action, resolve, reject }
        pendingRef.current = p
        setPending(p)
      })
      return { turnstileToken }
    },
    [],
  )

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      let msg: { type?: string; token?: string } = {}
      try {
        msg = JSON.parse(e.nativeEvent.data)
      } catch {
        return
      }
      if (msg.type === 'turnstile' && typeof msg.token === 'string' && msg.token) finish((p) => p.resolve(msg.token as string))
      if (msg.type === 'turnstile-error') finish((p) => p.reject(new Error('TURNSTILE_FAILED')))
    },
    [finish],
  )

  const base = apiBaseUrl()
  return (
    <HumanCheckContext.Provider value={requestProof}>
      {children}
      <Modal visible={!!pending} animationType="fade" onRequestClose={() => finish((p) => p.reject(new Error('CANCELLED')))}>
        <View style={[styles.root, { backgroundColor: colors.background }]}>
          {pending ? (
            <WebView
              source={{ uri: `${base}/${locale}/app-check?action=${encodeURIComponent(pending.action)}` }}
              onMessage={onMessage}
              // 只允许停留在自家网站和 Cloudflare 校验页；其他跳转一律不打开
              originWhitelist={[base, 'https://challenges.cloudflare.com']}
              onShouldStartLoadWithRequest={(req) => req.url.startsWith(base) || req.url.startsWith('https://challenges.cloudflare.com')}
              incognito
              javaScriptEnabled
              setSupportMultipleWindows={false}
              style={styles.web}
            />
          ) : null}
          <View style={styles.footer}>
            <Button label={t('cancel')} variant="secondary" onPress={() => finish((p) => p.reject(new Error('CANCELLED')))} fullWidth />
          </View>
        </View>
      </Modal>
    </HumanCheckContext.Provider>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 48 },
  web: { flex: 1, backgroundColor: 'transparent' },
  footer: { padding: 16 },
})
