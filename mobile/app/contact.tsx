import { useNavigation, usePreventRemove, useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, Text } from 'react-native'
import { useTranslations } from 'use-intl'

import { Button, Card, ErrorState, ListSkeleton, OfflineBanner, Screen, Sheet, TextField, TopBar, useToast } from '@/components/ui'
import { CONTACT_FIELDS, toContactBody, useContact, useSaveContact, type ContactField } from '@/features/contact/api'
import { useErrorMessage } from '@/i18n/error-message'
import { ApiError } from '@/lib/api-client'
import { useOnline } from '@/lib/online'
import { useTheme } from '@/theme/use-theme'
import type { MobileContact } from '@shared/mobile-api'

/** 联系方式（投递前至少填一项）。与 Web /s/contact 一样整份提交，清空的项会被删除 */
export default function Contact() {
  const t = useTranslations('contact')
  const errorMessage = useErrorMessage()
  const contact = useContact()
  if (contact.isPending)
    return (
      <Screen>
        <TopBar title={t('title')} />
        <ListSkeleton rows={2} />
      </Screen>
    )
  if (contact.isError)
    return (
      <Screen>
        <TopBar title={t('title')} />
        <ErrorState message={errorMessage(contact.error)} onRetry={() => void contact.refetch()} />
      </Screen>
    )
  return <ContactForm initial={contact.data} />
}

const META: Record<ContactField, { label: string; placeholder: string; keyboard: 'phone-pad' | 'email-address' | 'default' | 'url'; autoComplete?: 'tel' | 'email' }> = {
  phone: { label: 'phoneLabel', placeholder: 'phonePlaceholder', keyboard: 'phone-pad', autoComplete: 'tel' },
  email: { label: 'emailLabel', placeholder: 'emailPlaceholder', keyboard: 'email-address', autoComplete: 'email' },
  whatsapp: { label: 'whatsappLabel', placeholder: 'whatsappPlaceholder', keyboard: 'phone-pad' },
  wechat: { label: 'wechatLabel', placeholder: 'wechatPlaceholder', keyboard: 'default' },
  linkedinUrl: { label: 'linkedinLabel', placeholder: 'linkedinPlaceholder', keyboard: 'url' },
}

function ContactForm({ initial }: { initial: MobileContact }) {
  const router = useRouter()
  const navigation = useNavigation()
  const toast = useToast()
  const online = useOnline()
  const t = useTranslations('contact')
  const ob = useTranslations('mobile.onboarding')
  const common = useTranslations('mobile.common')
  const errorMessage = useErrorMessage()
  const { colors } = useTheme()
  const save = useSaveContact()
  const [form, setForm] = useState<Record<ContactField, string>>(() => Object.fromEntries(CONTACT_FIELDS.map((k) => [k, initial[k] ?? ''])) as Record<ContactField, string>)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingLeave, setPendingLeave] = useState<null | (() => void)>(null)
  usePreventRemove(dirty, ({ data }) => setPendingLeave(() => () => navigation.dispatch(data.action)))

  async function submit() {
    setError(null)
    try {
      await save.mutateAsync(toContactBody(form))
      setDirty(false)
      toast(t('saveSuccess'))
      setTimeout(() => router.back(), 0)
    } catch (err) {
      // 服务端只回 code：格式问题统一提示"手机号需含国际区号"等
      setError(err instanceof ApiError && err.code === 'VALIDATION_ERROR' ? t('errorValidation') : errorMessage(err))
    }
  }

  return (
    <Screen
      footer={
        <>
          {error ? (
            <Text testID="contact-error" accessibilityRole="alert" style={{ color: colors.destructive }}>
              {error}
            </Text>
          ) : null}
          <Button testID="contact-save" label={t('save')} onPress={submit} loading={save.isPending} disabled={!online} fullWidth />
        </>
      }
    >
      <TopBar title={t('title')} />
      <OfflineBanner />
      <Card style={{ backgroundColor: colors.muted, borderColor: colors.muted }}>
        <Text style={[styles.note, { color: colors.foreground }]}>{t('privacyNotice')}</Text>
      </Card>
      {CONTACT_FIELDS.map((k) => (
        <TextField
          key={k}
          testID={`contact-${k}`}
          label={t(META[k].label as 'phoneLabel')}
          placeholder={t(META[k].placeholder as 'phonePlaceholder')}
          value={form[k]}
          onChangeText={(v) => {
            setForm((f) => ({ ...f, [k]: v }))
            setDirty(true)
          }}
          keyboardType={META[k].keyboard}
          autoComplete={META[k].autoComplete}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={k === 'linkedinUrl' ? 300 : 200}
        />
      ))}
      <Sheet open={pendingLeave !== null} onClose={() => setPendingLeave(null)} title={ob('discardTitle')} closeLabel={common('close')}>
        <Text style={{ color: colors.foreground }}>{ob('discardBody')}</Text>
        <Button
          label={ob('discardConfirm')}
          variant="destructive"
          fullWidth
          onPress={() => {
            const leave = pendingLeave
            setPendingLeave(null)
            setDirty(false)
            leave?.()
          }}
        />
        <Button label={ob('discardCancel')} variant="secondary" fullWidth onPress={() => setPendingLeave(null)} />
      </Sheet>
    </Screen>
  )
}

const styles = StyleSheet.create({
  note: { fontSize: 14, lineHeight: 21 },
})
