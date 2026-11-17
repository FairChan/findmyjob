import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { StyleSheet, Text } from 'react-native'
import { useLocale, useTranslations } from 'use-intl'

import { Button, Screen } from '@/components/ui'
import { signOut, webUrl } from '@/features/auth/actions'
import { useTheme } from '@/theme/use-theme'

/** 企业和管理员账号：v1.0 只做学生端，引导去网页版（企业轻量版是 MA4 / v1.1） */
export default function EmployerNotice() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const locale = useLocale()
  const t = useTranslations('mobile.auth')
  const { colors } = useTheme()
  return (
    <Screen
      edges={['top', 'left', 'right', 'bottom']}
      footer={
        <>
          <Button label="findmyjob.asia" onPress={() => void WebBrowser.openBrowserAsync(webUrl(`/${locale}/e`))} fullWidth />
          <Button
            label={t('signOut')}
            variant="secondary"
            onPress={async () => {
              await signOut()
              queryClient.clear()
              router.replace('/welcome')
            }}
            fullWidth
          />
        </>
      }
    >
      <Text accessibilityRole="header" style={[styles.title, { color: colors.brand }]}>
        FindMYJob
      </Text>
      <Text style={[styles.body, { color: colors.foreground }]}>{t('employerOnWeb')}</Text>
    </Screen>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 34, fontWeight: '700', marginTop: 48 },
  body: { fontSize: 17, lineHeight: 26 },
})
