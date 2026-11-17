import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, Text } from 'react-native'
import { useLocale, useTranslations } from 'use-intl'

import { Button, Screen, useToast } from '@/components/ui'
import { resendVerification } from '@/features/auth/actions'
import { useHumanCheck } from '@/features/auth/human-check'
import { useErrorMessage } from '@/i18n/error-message'
import { useTheme } from '@/theme/use-theme'

/** S03 去邮箱验证：Web 用邮件链接验证（OTP 验证是禁用路径），点完链接回来登录 */
export default function CheckEmail() {
  const { email = '' } = useLocalSearchParams<{ email?: string }>()
  const router = useRouter()
  const requestProof = useHumanCheck()
  const locale = useLocale()
  const t = useTranslations('mobile.auth')
  const toast = useToast()
  const errorMessage = useErrorMessage()
  const { colors } = useTheme()
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(false)

  async function resend() {
    setBusy(true)
    try {
      await resendVerification(requestProof, { email, locale })
      toast(t('resent'))
      setCooldown(true)
      setTimeout(() => setCooldown(false), 60_000)
    } catch (err) {
      if (!(err instanceof Error && err.message === 'CANCELLED')) toast(errorMessage(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen
      edges={['top', 'left', 'right', 'bottom']}
      footer={
        <>
          <Button testID="check-email-sign-in" label={t('signIn')} onPress={() => router.replace('/sign-in')} fullWidth />
          <Button label={t('resendEmail')} variant="secondary" onPress={resend} loading={busy} disabled={!email || cooldown} fullWidth />
        </>
      }
    >
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
        {t('checkEmailTitle')}
      </Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>{t('checkEmailBody', { email })}</Text>
    </Screen>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '700' },
  body: { fontSize: 17, lineHeight: 26 },
})
