import { mobilePushPreferencesSchema, type MobilePushPreferences } from '@shared/mobile-api'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { StyleSheet, Text } from 'react-native'
import { useLocale, useTranslations } from 'use-intl'

import { Button, SwitchRow } from '@/components/ui'
import { apiFetch } from '@/lib/api-client'
import { useTheme } from '@/theme/use-theme'
import { pushSupport, requestPermissionAndRegister, type PushSupport } from './push'

const KEY = ['push-preferences'] as const

/** 设置页的推送区块（MA3-T03）：系统权限状态 + 分类开关 + 夜间免打扰 */
export function PushSettings({ online }: { online: boolean }) {
  const t = useTranslations('mobile.push')
  const locale = useLocale() as 'zh' | 'en'
  const { colors } = useTheme()
  const queryClient = useQueryClient()
  const [support, setSupport] = useState<PushSupport | null>(null)
  useEffect(() => {
    void pushSupport().then(setSupport)
  }, [])

  const prefs = useQuery({ queryKey: KEY, queryFn: ({ signal }) => apiFetch('/push-preferences', { schema: mobilePushPreferencesSchema, signal }) })
  const patch = useMutation({
    mutationFn: (input: Partial<MobilePushPreferences>) => apiFetch('/push-preferences', { method: 'PATCH', body: input, schema: mobilePushPreferencesSchema }),
    onSuccess: (data) => queryClient.setQueryData(KEY, data),
  })

  const row = (key: keyof MobilePushPreferences, label: string, description?: string) => (
    <SwitchRow
      key={key}
      testID={`push-pref-${key}`}
      label={label}
      description={description}
      value={!!prefs.data?.[key]}
      disabled={!prefs.data || patch.isPending || !online || support !== 'granted'}
      onChange={(next) => patch.mutate({ [key]: next })}
    />
  )

  return (
    <>
      {support === 'granted' ? <Text style={[styles.note, { color: colors.mutedForeground }]}>{t('enabled')}</Text> : null}
      {support === 'undetermined' ? (
        <Button
          testID="push-enable"
          label={t('enable')}
          variant="secondary"
          onPress={async () => setSupport(await requestPermissionAndRegister(locale))}
        />
      ) : null}
      {support === 'denied' ? <Text style={[styles.note, { color: colors.mutedForeground }]}>{t('denied')}</Text> : null}
      {support === 'unsupported' ? <Text style={[styles.note, { color: colors.mutedForeground }]}>{t('unsupported')}</Text> : null}
      {row('applications', t('applications'))}
      {row('invitations', t('invitations'))}
      {row('account', t('account'))}
      {row('quietHours', t('quietHours'), t('quietHoursDesc'))}
    </>
  )
}

const styles = StyleSheet.create({ note: { fontSize: 14, lineHeight: 20 } })
