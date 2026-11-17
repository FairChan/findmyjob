import * as WebBrowser from 'expo-web-browser'
import { Phone, ShieldAlert } from 'lucide-react-native'
import { Linking, StyleSheet, Text, View } from 'react-native'
import { useLocale, useTranslations } from 'use-intl'

import { Button, Card, Screen, SectionTitle, TopBar } from '@/components/ui'
import { webUrl } from '@/features/auth/actions'
import { useTheme } from '@/theme/use-theme'

/**
 * S24 帮助与防骗：要点直接写在 App 里（离线也能看），完整的案例、指南和核实过的联系方式
 * 在网页版的 /safety（由运营在后台发布）。API 下发 safety 内容属于后续工作，见 MA2 报告。
 */
export default function Help() {
  const locale = useLocale()
  const t = useTranslations('mobile.help')
  const safety = useTranslations('safety')
  const { colors } = useTheme()
  const tips = [t('tip1'), t('tip2'), t('tip3'), t('tip4')]
  return (
    <Screen>
      <TopBar title={t('title')} />
      <Card>
        <View style={styles.row}>
          <ShieldAlert color={colors.destructive} size={22} />
          <Text accessibilityRole="header" style={[styles.cardTitle, { color: colors.foreground }]}>
            {t('tipsTitle')}
          </Text>
        </View>
        {tips.map((tip, i) => (
          <Text key={i} style={[styles.tip, { color: colors.foreground }]}>
            {`${i + 1}. ${tip}`}
          </Text>
        ))}
      </Card>
      <Button testID="help-safety-web" label={t('moreOnWeb')} variant="secondary" accessibilityHint={t('opensWeb')} onPress={() => void WebBrowser.openBrowserAsync(webUrl(`/${locale}/safety`))} />

      <SectionTitle>{safety('emergencyTitle')}</SectionTitle>
      <Card>
        <Text style={[styles.tip, { color: colors.foreground }]}>{safety('emergency')}</Text>
        <Text style={{ color: colors.mutedForeground, lineHeight: 21 }}>{safety('verifiedContacts')}</Text>
        <Button testID="help-call-999" label={t('call999')} variant="destructive" icon={<Phone color={colors.brandForeground} size={18} />} onPress={() => void Linking.openURL('tel:999')} />
      </Card>
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 18, fontWeight: '600', flex: 1 },
  tip: { fontSize: 16, lineHeight: 24 },
})
