import { useState } from 'react'
import { StyleSheet, Text } from 'react-native'
import { useTranslations } from 'use-intl'

import { Button, Card, OfflineBanner, Screen, Sheet, TextField, TopBar } from '@/components/ui'
import { deleteAccount } from '@/features/privacy/api'
import { useErrorMessage } from '@/i18n/error-message'
import { emitAppEvent } from '@/lib/app-events'
import { useOnline } from '@/lib/online'
import { useTheme } from '@/theme/use-theme'

/**
 * 注销账号（S20）：不可逆，两道确认——先手动输入确认词，再在底部抽屉里点最终确认。
 * 服务端成功后已经吊销全部会话；这里广播 signed-out，根布局负责清空 SecureStore 的会话和查询缓存并回到欢迎页。
 */
export default function DeleteAccount() {
  const t = useTranslations('privacy')
  const m = useTranslations('mobile.privacy')
  const common = useTranslations('mobile.common')
  const errorMessage = useErrorMessage()
  const online = useOnline()
  const { colors } = useTheme()
  const [typed, setTyped] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const phrase = t('deleteConfirmPlaceholder')
  const matches = typed.trim() === phrase

  async function submit() {
    setConfirming(false)
    setBusy(true)
    setError(null)
    try {
      await deleteAccount()
      emitAppEvent('signed-out')
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Screen
      footer={
        <>
          {error ? (
            <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
              {error}
            </Text>
          ) : null}
          <Button testID="delete-continue" label={t('deleteButton')} variant="destructive" disabled={!matches || !online} loading={busy} onPress={() => setConfirming(true)} fullWidth />
        </>
      }
    >
      <TopBar title={t('deleteConfirmTitle')} />
      <OfflineBanner />
      <Card style={{ borderColor: colors.destructive }}>
        <Text style={[styles.body, { color: colors.foreground }]}>{t('deleteDesc')}</Text>
        <Text style={[styles.body, { color: colors.foreground }]}>{m('deleteConsequences')}</Text>
      </Card>
      <TextField
        testID="delete-phrase"
        label={`${t('deleteConfirmType')} ${phrase}`}
        placeholder={phrase}
        value={typed}
        onChangeText={setTyped}
        autoCapitalize="characters"
        autoCorrect={false}
      />
      <Sheet open={confirming} onClose={() => setConfirming(false)} title={t('deleteConfirmTitle')} closeLabel={common('close')}>
        <Text style={[styles.body, { color: colors.foreground }]}>{t('deleteConfirmDesc')}</Text>
        <Button testID="delete-final" label={t('deleteConfirmButton')} variant="destructive" fullWidth onPress={submit} />
        <Button label={t('deleteCancel')} variant="secondary" fullWidth onPress={() => setConfirming(false)} />
      </Sheet>
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { fontSize: 16, lineHeight: 24 },
})
