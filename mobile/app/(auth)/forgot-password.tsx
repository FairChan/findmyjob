import { useState } from 'react'
import { StyleSheet, Text } from 'react-native'
import { useLocale, useTranslations } from 'use-intl'

import { Button, Screen, TextField } from '@/components/ui'
import { requestPasswordReset } from '@/features/auth/actions'
import { useHumanCheck } from '@/features/auth/human-check'
import { useErrorMessage } from '@/i18n/error-message'
import { useTheme } from '@/theme/use-theme'

/** 找回密码：邮件里的重置链接在网页完成（和 Web 同一流程），App 只负责发起 */
export default function ForgotPassword() {
  const requestProof = useHumanCheck()
  const locale = useLocale()
  const t = useTranslations('mobile.auth')
  const errorMessage = useErrorMessage()
  const { colors } = useTheme()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await requestPasswordReset(requestProof, { email: email.trim(), locale })
      setSent(true)
    } catch (err) {
      if (!(err instanceof Error && err.message === 'CANCELLED')) setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} footer={sent ? null : <Button label={t('forgotPassword')} onPress={submit} loading={busy} disabled={!email} fullWidth />}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
        {t('forgotPassword')}
      </Text>
      {sent ? (
        // 不论邮箱是否存在都显示同一句话（防枚举，和 Web 一致）
        <Text accessibilityRole="alert" style={[styles.body, { color: colors.foreground }]}>
          {t('resetSent')}
        </Text>
      ) : (
        <TextField label={t('email')} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
      )}
      {error ? <Text style={{ color: colors.destructive }}>{error}</Text> : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '700' },
  body: { fontSize: 17, lineHeight: 26 },
})
