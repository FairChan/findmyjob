import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { StyleSheet, Text } from 'react-native'
import { useLocale, useTranslations } from 'use-intl'

import { Button, Screen } from '@/components/ui'
import { webUrl } from '@/features/auth/actions'
import { useTheme } from '@/theme/use-theme'

/**
 * S22 条款更新：服务端返回 409 NEEDS_RECONSENT 时进入。同意动作在网页版的 /legal/reconsent 完成
 * （同一账号、同一套同意记录与审计），完成后回到 App 点"继续"重试。
 */
export default function Reconsent() {
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('mobile.status')
  const common = useTranslations('mobile.common')
  const { colors } = useTheme()
  return (
    <Screen
      edges={['top', 'left', 'right', 'bottom']}
      footer={
        <>
          <Button label={common('confirm')} onPress={() => void WebBrowser.openBrowserAsync(webUrl(`/${locale}/legal/reconsent`))} fullWidth />
          <Button label={common('next')} variant="secondary" onPress={() => router.replace('/')} fullWidth />
        </>
      }
    >
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
        {t('reconsentTitle')}
      </Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>{t('reconsentBody')}</Text>
    </Screen>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '700', marginTop: 48 },
  body: { fontSize: 17, lineHeight: 26 },
})
