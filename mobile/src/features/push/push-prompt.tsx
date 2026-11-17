import { useEffect, useState } from 'react'
import { StyleSheet, Text } from 'react-native'
import { useLocale, useTranslations } from 'use-intl'

import { Button, Sheet } from '@/components/ui'
import { useTheme } from '@/theme/use-theme'
import { markPushPrompted, requestPermissionAndRegister, shouldOfferPushPrompt } from './push'

/**
 * 第一次投递成功后的"开启通知"说明（MOBILE.md §4.3）：先用我们自己的话讲清楚用途，
 * 学生点"开启"才弹系统授权框；点"以后再说"就不再自动问。
 */
export function PushPrompt({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const locale = useLocale() as 'zh' | 'en'
  const t = useTranslations('mobile.apply')
  const common = useTranslations('mobile.common')
  const { colors } = useTheme()

  useEffect(() => {
    if (!enabled) return
    let alive = true
    void shouldOfferPushPrompt().then((offer) => {
      if (alive && offer) setOpen(true)
    })
    return () => {
      alive = false
    }
  }, [enabled])

  async function close() {
    setOpen(false)
    await markPushPrompted()
  }

  return (
    <Sheet open={open} onClose={() => void close()} title={t('notifyEnable')} closeLabel={common('close')}>
      <Text style={[styles.body, { color: colors.foreground }]}>{t('notifyPrompt')}</Text>
      <Button
        testID="push-prompt-enable"
        label={t('notifyEnable')}
        loading={busy}
        onPress={async () => {
          setBusy(true)
          try {
            await requestPermissionAndRegister(locale)
          } finally {
            setBusy(false)
            await close()
          }
        }}
        fullWidth
      />
      <Button testID="push-prompt-later" label={t('notifyLater')} variant="ghost" onPress={() => void close()} fullWidth />
    </Sheet>
  )
}

const styles = StyleSheet.create({ body: { fontSize: 16, lineHeight: 24 } })
