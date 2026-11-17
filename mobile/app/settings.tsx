import Constants from 'expo-constants'
import { Check } from 'lucide-react-native'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { Button, Card, OfflineBanner, Screen, SectionTitle, SwitchRow, TopBar, useToast } from '@/components/ui'
import { useSignOut } from '@/features/auth/use-sign-out'
import { PushSettings } from '@/features/push/push-settings'
import { patchLocale, useNotificationPrefs, useSetWeeklyDigest } from '@/features/settings/api'
import { usePreferences } from '@/features/settings/prefs'
import { useErrorMessage } from '@/i18n/error-message'
import type { AppLocale } from '@/i18n/messages'
import { useOnline } from '@/lib/online'
import { useTheme, type ThemePreference } from '@/theme/use-theme'

/** S21 设置：语言（立即生效 + 同步到服务端）、深浅色、通知偏好、退出登录 */
export default function Settings() {
  const signOut = useSignOut()
  const toast = useToast()
  const online = useOnline()
  const { locale, setLocale, theme, setTheme } = usePreferences()
  const t = useTranslations('mobile.me')
  const s = useTranslations('mobile.settings')
  const ls = useTranslations('localeSwitcher')
  const auth = useTranslations('mobile.auth')
  const errorMessage = useErrorMessage()
  const { colors } = useTheme()
  const prefs = useNotificationPrefs()
  const p = useTranslations('mobile.push')
  const setDigest = useSetWeeklyDigest()

  function changeLocale(next: AppLocale) {
    if (next === locale) return
    setLocale(next)
    // 本机先生效；服务端同步失败不回滚界面语言，只提示一下（影响的是邮件和推送的语言）
    patchLocale(next).catch(() => toast(s('localeSyncFailed'), 'error'))
  }

  const digest = prefs.data?.weeklyDigest
  return (
    <Screen
      footer={
        <Button
          testID="settings-sign-out"
          label={auth('signOut')}
          variant="secondary"
          fullWidth
          onPress={signOut}
        />
      }
    >
      <TopBar title={s('title')} />
      <OfflineBanner />

      <SectionTitle>{t('language')}</SectionTitle>
      <Card>
        <View accessibilityRole="radiogroup">
          {(['zh', 'en'] as const).map((l) => (
            <Choice key={l} testID={`locale-${l}`} label={ls(l)} selected={locale === l} onPress={() => changeLocale(l)} />
          ))}
        </View>
      </Card>

      <SectionTitle>{t('theme')}</SectionTitle>
      <Card>
        <View accessibilityRole="radiogroup">
          {(['system', 'light', 'dark'] as ThemePreference[]).map((v) => (
            <Choice
              key={v}
              testID={`theme-${v}`}
              label={{ system: t('themeSystem'), light: t('themeLight'), dark: t('themeDark') }[v]}
              selected={theme === v}
              onPress={() => setTheme(v)}
            />
          ))}
        </View>
      </Card>

      <SectionTitle>{t('notifications')}</SectionTitle>
      <Card>
        {prefs.isError ? (
          <Text style={{ color: colors.mutedForeground }}>{errorMessage(prefs.error)}</Text>
        ) : (
          <SwitchRow
            testID="settings-digest"
            label={s('weeklyDigest')}
            description={digest && !digest.available ? s('weeklyDigestUnavailable') : s('weeklyDigestDesc')}
            value={!!digest?.granted}
            disabled={!digest?.available || setDigest.isPending || !online}
            onChange={(next) => {
              const version = prefs.data?.legalVersion
              if (next && !version) return
              setDigest.mutate(next ? { granted: true, submittedVersion: version! } : { granted: false }, {
                onError: (err) => toast(errorMessage(err), 'error'),
              })
            }}
          />
        )}
      </Card>

      <SectionTitle>{p('title')}</SectionTitle>
      <Card>
        <PushSettings online={online} />
      </Card>

      <Text style={[styles.version, { color: colors.mutedForeground }]}>{t('version', { version: Constants.expoConfig?.version ?? '' })}</Text>
    </Screen>
  )
}

function Choice({ label, selected, onPress, testID }: { label: string; selected: boolean; onPress: () => void; testID?: string }) {
  const { colors, minTouchTarget } = useTheme()
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.choice, { minHeight: minTouchTarget }]}
    >
      <Text style={[styles.choiceText, { color: colors.foreground, fontWeight: selected ? '600' : '400' }]}>{label}</Text>
      {selected ? <Check color={colors.brand} size={20} /> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  choice: { flexDirection: 'row', alignItems: 'center' },
  choiceText: { flex: 1, fontSize: 16 },
  note: { fontSize: 13, lineHeight: 18 },
  version: { textAlign: 'center', fontSize: 13 },
})
