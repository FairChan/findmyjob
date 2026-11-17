import * as WebBrowser from 'expo-web-browser'
import { StyleSheet, Text } from 'react-native'
import { useLocale, useTranslations } from 'use-intl'

import { Button, Screen } from '@/components/ui'
import { webUrl } from '@/features/auth/actions'
import { useSignOut } from '@/features/auth/use-sign-out'
import { useTheme } from '@/theme/use-theme'

/** 管理员账号：App 里没有管理功能，引导去网页版（企业成员走 /e 企业外壳，MA4-T02） */
export default function EmployerNotice() {
  const signOut = useSignOut()
  const locale = useLocale()
  const t = useTranslations('mobile.auth')
  const { colors } = useTheme()
  return (
    <Screen
      edges={['top', 'left', 'right', 'bottom']}
      footer={
        <>
          <Button label="findmyjob.asia" onPress={() => void WebBrowser.openBrowserAsync(webUrl(`/${locale}/admin`))} fullWidth />
          <Button
            label={t('signOut')}
            variant="secondary"
            onPress={signOut}
            fullWidth
          />
        </>
      }
    >
      <Text accessibilityRole="header" style={[styles.title, { color: colors.brand }]}>
        FindMYJob
      </Text>
      <Text style={[styles.body, { color: colors.foreground }]}>{t('adminOnWeb')}</Text>
    </Screen>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 34, fontWeight: '700', marginTop: 48 },
  body: { fontSize: 17, lineHeight: 26 },
})
