import * as WebBrowser from 'expo-web-browser'
import { StyleSheet, Text } from 'react-native'
import { useLocale, useTranslations } from 'use-intl'

import { Button, Screen } from '@/components/ui'
import { webUrl } from '@/features/auth/actions'
import { useTheme } from '@/theme/use-theme'

/** S23 强制更新：服务端返回 426 时进入，不能返回 */
export default function UpdateRequired() {
  const t = useTranslations('mobile.status')
  const locale = useLocale()
  const { colors } = useTheme()
  return (
    <Screen
      edges={['top', 'left', 'right', 'bottom']}
      footer={<Button label={t('updateAction')} onPress={() => void WebBrowser.openBrowserAsync(webUrl(`/${locale}/app`))} fullWidth />}
    >
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
        {t('updateTitle')}
      </Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>{t('updateBody')}</Text>
    </Screen>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 28, fontWeight: '700', marginTop: 48 },
  body: { fontSize: 17, lineHeight: 26 },
})
