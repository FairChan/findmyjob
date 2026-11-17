import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useState } from 'react'
import { StyleSheet, Text } from 'react-native'
import { useLocale, useTranslations } from 'use-intl'

import { Button, Checkbox, Screen, TextField } from '@/components/ui'
import { signUpStudent, webUrl } from '@/features/auth/actions'
import { useHumanCheck } from '@/features/auth/human-check'
import { useErrorMessage } from '@/i18n/error-message'
import { useTheme } from '@/theme/use-theme'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// 与服务端 register 的校验一致：8–128 位
const PASSWORD_RE = /^.{8,128}$/s

/** S02 学生注册（企业注册只在网页版） */
export default function SignUp() {
  const router = useRouter()
  const requestProof = useHumanCheck()
  const locale = useLocale()
  const t = useTranslations('mobile.auth')
  const errorMessage = useErrorMessage()
  const { colors } = useTheme()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [agreePrivacy, setAgreePrivacy] = useState(false)
  const [joinTalentPool, setJoinTalentPool] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const emailOk = EMAIL_RE.test(email.trim())
  const passwordOk = PASSWORD_RE.test(password)
  const canSubmit = name.trim().length > 0 && emailOk && passwordOk && agreeTerms && agreePrivacy

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await signUpStudent(requestProof, { name: name.trim(), email: email.trim(), password, agreeTerms, agreePrivacy, joinTalentPool, locale })
      router.replace({ pathname: '/check-email', params: { email: email.trim() } })
    } catch (err) {
      if (err instanceof Error && err.message === 'CANCELLED') return
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const legal = (slug: 'terms' | 'privacy', label: string) => (
    <Button label={label} variant="ghost" onPress={() => void WebBrowser.openBrowserAsync(webUrl(`/${locale}/legal/${slug}`))} />
  )

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']} footer={<Button testID="sign-up-submit" label={t('signUp')} onPress={submit} loading={busy} disabled={!canSubmit} fullWidth />}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
        {t('signUp')}
      </Text>
      <TextField testID="sign-up-name" label={t('name')} value={name} onChangeText={setName} autoComplete="name" textContentType="name" />
      <TextField testID="sign-up-email" label={t('email')} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress" />
      <TextField
        testID="sign-up-password"
        label={t('password')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        helper={t('passwordHelper')}
        error={password && !passwordOk ? t('passwordHelper') : null}
      />
      <Checkbox testID="sign-up-terms" checked={agreeTerms} onChange={setAgreeTerms} label={t('agreeTerms')} extra={legal('terms', t('readTerms'))} />
      <Checkbox testID="sign-up-privacy" checked={agreePrivacy} onChange={setAgreePrivacy} label={t('agreePrivacy')} extra={legal('privacy', t('readPrivacy'))} />
      <Checkbox checked={joinTalentPool} onChange={setJoinTalentPool} label={t('joinTalentPool')} />
      {error ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>
          {error}
        </Text>
      ) : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '700' },
  error: { fontSize: 15, lineHeight: 21 },
})
