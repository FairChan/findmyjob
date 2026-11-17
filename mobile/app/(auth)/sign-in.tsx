import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, Text } from 'react-native'
import { useTranslations } from 'use-intl'

import { Button, Screen, TextField } from '@/components/ui'
import { AuthActionError, signInWithEmail } from '@/features/auth/actions'
import { useHumanCheck } from '@/features/auth/human-check'
import { useErrorMessage } from '@/i18n/error-message'
import { resetAllCaches } from '@/lib/query-persist'
import { useTheme } from '@/theme/use-theme'

/** S04 登录 */
export default function SignIn() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const requestProof = useHumanCheck()
  const t = useTranslations('mobile.auth')
  const errorMessage = useErrorMessage()
  const { colors } = useTheme()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await signInWithEmail(requestProof, { email: email.trim(), password })
      // 新登录一律从空缓存开始：内存和磁盘里可能还有别的账号留下的数据（安全复查）
      await resetAllCaches(queryClient)
      router.replace('/')
    } catch (err) {
      if (err instanceof AuthActionError && err.code === 'EMAIL_NOT_VERIFIED') {
        router.push({ pathname: '/check-email', params: { email: email.trim() } })
        return
      }
      if (err instanceof Error && err.message === 'CANCELLED') return
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen
      edges={['top', 'left', 'right', 'bottom']}
      footer={<Button testID="sign-in-submit" label={t('signIn')} onPress={submit} loading={busy} disabled={!email || !password} fullWidth />}
    >
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
        {t('signIn')}
      </Text>
      <TextField testID="sign-in-email" label={t('email')} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
      <TextField testID="sign-in-password" label={t('password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={submit} />
      {error ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>
          {error}
        </Text>
      ) : null}
      <Button label={t('forgotPassword')} variant="ghost" onPress={() => router.push('/forgot-password')} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '700' },
  error: { fontSize: 15, lineHeight: 21 },
})
