import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { BadgeCheck } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useLocale, useTranslations } from 'use-intl'

import { Button, Card, EmptyState, ErrorState, ListSkeleton, OfflineBanner, Screen, SelectField, TextField, TopBar, useToast } from '@/components/ui'
import { useCompleteness, useProfile, useSchools } from '@/features/profile/api'
import { confirmSchoolOtp, emailMatchesSchool, sendSchoolOtp } from '@/features/school/api'
import { useErrorMessage } from '@/i18n/error-message'
import { ApiError } from '@/lib/api-client'
import { useOnline } from '@/lib/online'
import { qk } from '@/lib/query-keys'
import { useTheme } from '@/theme/use-theme'

const RESEND_SECONDS = 60

/** S06 学校认证：选学校 → 学校邮箱 → 6 位验证码 */
export default function SchoolVerification() {
  const t = useTranslations('schoolVerify')
  const m = useTranslations('mobile.school')
  const { colors } = useTheme()
  const errorMessage = useErrorMessage()
  const completeness = useCompleteness()
  const profile = useProfile()
  const schools = useSchools()
  const [changing, setChanging] = useState(false)

  const query = [completeness, profile, schools]
  const failed = query.find((q) => q.isError)
  let body
  if (query.some((q) => q.isPending)) body = <ListSkeleton rows={2} />
  else if (failed) body = <ErrorState message={errorMessage(failed.error)} onRetry={() => query.forEach((q) => void q.refetch())} />
  else if (completeness.data?.schoolVerified && !changing) body = <Verified onChange={() => setChanging(true)} />
  else if (!schools.data?.items.length) body = <EmptyState title={t('title')} body={m('noSchools')} />
  else body = <VerifyForm schools={schools.data.items} defaultSchoolId={profile.data?.schoolId ?? null} />

  return (
    <Screen>
      <TopBar title={t('title')} />
      <OfflineBanner />
      <Text style={[styles.lead, { color: colors.mutedForeground }]}>{t('subtitle')}</Text>
      {body}
    </Screen>
  )
}

function Verified({ onChange }: { onChange: () => void }) {
  const t = useTranslations('schoolVerify')
  const { colors } = useTheme()
  return (
    <Card>
      <View style={styles.verifiedRow}>
        <BadgeCheck color={colors.brand} size={24} />
        <Text testID="school-verified" style={[styles.verifiedText, { color: colors.foreground }]}>
          {t('alreadyVerified')}
        </Text>
      </View>
      <Button label={t('changeEmail')} variant="secondary" onPress={onChange} />
    </Card>
  )
}

function VerifyForm({ schools, defaultSchoolId }: { schools: { id: string; nameZh: string; nameEn: string; emailDomains: string[] }[]; defaultSchoolId: string | null }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const toast = useToast()
  const online = useOnline()
  const locale = useLocale()
  const t = useTranslations('schoolVerify')
  const m = useTranslations('mobile.school')
  const errorMessage = useErrorMessage()
  const { colors } = useTheme()

  const [schoolId, setSchoolId] = useState<string | null>(defaultSchoolId && schools.some((s) => s.id === defaultSchoolId) ? defaultSchoolId : null)
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const school = schools.find((s) => s.id === schoolId)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  // 服务端错误只回 code：VALIDATION_ERROR 和 429 换成学校认证语境下的文案
  function mapError(err: unknown, phase: 'send' | 'confirm'): string {
    if (err instanceof ApiError) {
      if (err.code === 'RATE_LIMITED') return t('errorRateLimited')
      if (err.code === 'VALIDATION_ERROR') return phase === 'send' ? m('sendRejected') : m('otpRejected')
    }
    return errorMessage(err)
  }

  async function send() {
    setError(null)
    if (!school) return setError(t('schoolPlaceholder'))
    if (!emailMatchesSchool(email, school.emailDomains)) return setError(t('errorDomainMismatch'))
    setBusy(true)
    try {
      await sendSchoolOtp({ schoolId: school.id, schoolEmail: email.trim() })
      setSentTo(email.trim())
      setCooldown(RESEND_SECONDS)
    } catch (err) {
      setError(mapError(err, 'send'))
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    setError(null)
    setBusy(true)
    try {
      await confirmSchoolOtp({ otp: otp.trim() })
      await queryClient.invalidateQueries({ queryKey: qk.profile })
      toast(t('successMessage'))
      router.back()
    } catch (err) {
      setError(mapError(err, 'confirm'))
    } finally {
      setBusy(false)
    }
  }

  const domainHint = school?.emailDomains[0] ? m('domainHint', { domain: school.emailDomains.join(' / ') }) : undefined

  return (
    <View style={styles.form}>
      <SelectField
        testID="school-select"
        label={t('schoolLabel')}
        placeholder={t('schoolPlaceholder')}
        value={schoolId}
        options={schools.map((s) => ({ value: s.id, label: locale === 'en' ? s.nameEn : s.nameZh }))}
        onChange={(v) => {
          setSchoolId(v)
          setSentTo(null)
        }}
      />
      <TextField
        testID="school-email"
        label={t('emailLabel')}
        placeholder={t('emailPlaceholder')}
        helper={domainHint}
        value={email}
        onChangeText={(v) => {
          setEmail(v)
          setSentTo(null)
        }}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        editable={!busy}
      />
      {!sentTo ? (
        <Button testID="school-send" label={t('sendOtpButton')} onPress={send} loading={busy} disabled={!online || !schoolId || !email.trim()} fullWidth />
      ) : (
        <>
          <Text accessibilityLiveRegion="polite" style={{ color: colors.mutedForeground, lineHeight: 21 }}>
            {t('otpSent', { email: sentTo })}
          </Text>
          <TextField
            testID="school-otp"
            label={t('otpLabel')}
            placeholder={t('otpPlaceholder')}
            value={otp}
            onChangeText={(v) => setOtp(v.replace(/\D/g, ''))}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={6}
            onSubmitEditing={confirm}
          />
          <Button testID="school-confirm" label={t('verifyButton')} onPress={confirm} loading={busy} disabled={!online || otp.length < 6} fullWidth />
          <Button
            label={cooldown > 0 ? m('resendIn', { seconds: cooldown }) : t('resendOtp')}
            variant="ghost"
            onPress={send}
            disabled={cooldown > 0 || busy || !online}
          />
        </>
      )}
      {error ? (
        <Text testID="school-error" accessibilityRole="alert" style={{ color: colors.destructive, lineHeight: 21 }}>
          {error}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  lead: { fontSize: 15, lineHeight: 22 },
  form: { gap: 16 },
  verifiedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  verifiedText: { flex: 1, fontSize: 16 },
})
