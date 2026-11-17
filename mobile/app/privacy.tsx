import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useFormatter, useLocale, useTranslations } from 'use-intl'

import { Button, Card, ErrorState, ListRow, ListSkeleton, OfflineBanner, Screen, SectionTitle, SwitchRow, TextField, TopBar, useToast } from '@/components/ui'
import { webUrl } from '@/features/auth/actions'
import { useSettledSearch } from '@/features/jobs/search'
import { useBlockCompany, useCompanySearch, usePrivacy, useRequestExport, useSetVisibility } from '@/features/privacy/api'
import { useErrorMessage } from '@/i18n/error-message'
import { useOnline } from '@/lib/online'
import { useTheme } from '@/theme/use-theme'

/** S20 隐私：人才库可见性、屏蔽企业、谁看过/解锁过我、数据导出、注销入口 */
export default function Privacy() {
  const router = useRouter()
  const toast = useToast()
  const online = useOnline()
  const locale = useLocale()
  const format = useFormatter()
  const t = useTranslations('privacy')
  const m = useTranslations('mobile.privacy')
  const me = useTranslations('mobile.me')
  const errorMessage = useErrorMessage()
  const { colors } = useTheme()
  const privacy = usePrivacy()
  const setVisibility = useSetVisibility()
  const block = useBlockCompany()
  const exportReq = useRequestExport()
  const [search, setSearch] = useState('')
  const [settled] = useSettledSearch(search, 400)
  const results = useCompanySearch(settled)

  if (privacy.isPending)
    return (
      <Screen>
        <TopBar title={t('title')} />
        <ListSkeleton rows={3} />
      </Screen>
    )
  if (privacy.isError)
    return (
      <Screen>
        <TopBar title={t('title')} />
        <ErrorState message={errorMessage(privacy.error)} onRetry={() => void privacy.refetch()} />
      </Screen>
    )

  const d = privacy.data
  const blockedIds = new Set(d.blockedCompanies.map((b) => b.companyId))
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' })
  const onError = (err: unknown) => toast(errorMessage(err), 'error')

  return (
    <Screen onRefresh={() => void privacy.refetch()} refreshing={privacy.isRefetching}>
      <TopBar title={t('title')} />
      <OfflineBanner />
      <Text style={[styles.lead, { color: colors.mutedForeground }]}>{t('subtitle')}</Text>

      <Card>
        <SwitchRow
          testID="privacy-visibility"
          label={t('visibilityTitle')}
          description={`${d.talentPoolVisible ? t('visibilityOn') : t('visibilityOff')}。${t('visibilityDesc')}`}
          value={d.talentPoolVisible}
          disabled={setVisibility.isPending || !online}
          onChange={(next) => setVisibility.mutate(next, { onError })}
        />
      </Card>

      <SectionTitle>{t('blockTitle')}</SectionTitle>
      <Text style={[styles.lead, { color: colors.mutedForeground }]}>{t('blockDesc')}</Text>
      <TextField testID="privacy-block-search" label={t('blockSearchResults')} placeholder={t('blockSearchPlaceholder')} value={search} onChangeText={setSearch} returnKeyType="search" maxLength={100} />
      {settled.trim() ? (
        <Card>
          {(results.data?.items ?? []).map((c) => (
            <View key={c.id} style={styles.row}>
              <Text style={[styles.flex, { color: colors.foreground }]}>{c.name}</Text>
              {blockedIds.has(c.id) ? (
                <Text style={{ color: colors.mutedForeground }}>{t('blockAlreadyBlocked')}</Text>
              ) : (
                <Button testID={`block-${c.id}`} label={m('block')} variant="secondary" disabled={!online || block.isPending} onPress={() => block.mutate({ companyId: c.id, block: true }, { onError, onSuccess: () => setSearch('') })} />
              )}
            </View>
          ))}
          {results.data && results.data.items.length === 0 ? <Text style={{ color: colors.mutedForeground }}>{m('noResults')}</Text> : null}
        </Card>
      ) : null}
      <Card>
        {d.blockedCompanies.length === 0 ? <Text style={{ color: colors.mutedForeground }}>{t('blockEmpty')}</Text> : null}
        {d.blockedCompanies.map((b) => (
          <View key={b.companyId} style={styles.row}>
            <Text style={[styles.flex, { color: colors.foreground }]}>{b.companyName}</Text>
            <Button
              testID={`unblock-${b.companyId}`}
              label={t('blockRemove')}
              variant="ghost"
              accessibilityLabel={`${t('blockRemove')} ${b.companyName}`}
              disabled={!online || block.isPending}
              onPress={() => block.mutate({ companyId: b.companyId, block: false }, { onError })}
            />
          </View>
        ))}
      </Card>

      <SectionTitle>{t('viewsTitle')}</SectionTitle>
      <Card>
        {d.profileViews.length === 0 ? <Text style={{ color: colors.mutedForeground }}>{t('viewsEmpty')}</Text> : null}
        {d.profileViews.map((v) => (
          <ListRow key={`${v.companyId}-${v.viewedAt}`} label={v.companyName} value={date(v.viewedAt)} />
        ))}
      </Card>

      <SectionTitle>{t('unlocksTitle')}</SectionTitle>
      <Card>
        {d.unlocks.length === 0 ? <Text style={{ color: colors.mutedForeground }}>{t('unlocksEmpty')}</Text> : null}
        {d.unlocks.map((u) => (
          <ListRow key={`${u.companyId}-${u.unlockedAt}`} label={u.companyName} value={u.source === 'APPLICATION' ? t('unlockSourceApplication') : date(u.unlockedAt)} />
        ))}
      </Card>

      <SectionTitle>{t('dataRightsTitle')}</SectionTitle>
      <Text style={[styles.lead, { color: colors.mutedForeground }]}>{t('dataRightsDesc')}</Text>
      <Card>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t('exportTitle')}</Text>
        <Text style={{ color: colors.mutedForeground, lineHeight: 21 }}>{t('exportDesc')}</Text>
        <Button
          testID="privacy-export"
          label={t('exportButton')}
          variant="secondary"
          loading={exportReq.isPending}
          disabled={!online}
          onPress={() =>
            exportReq.mutate(undefined, {
              onSuccess: (r) => toast(r.existing ? m('exportExisting') : t('exportRequested')),
              onError,
            })
          }
        />
        <Button label={t('exportViewLink')} variant="ghost" accessibilityHint={m('opensWeb')} onPress={() => void WebBrowser.openBrowserAsync(webUrl(`/${locale}/s/privacy`))} />
      </Card>
      <Card>
        <Text style={[styles.cardTitle, { color: colors.destructive }]}>{t('deleteTitle')}</Text>
        <Text style={{ color: colors.mutedForeground, lineHeight: 21 }}>{t('deleteDesc')}</Text>
        <Button testID="privacy-delete" label={me('deleteAccount')} variant="destructive" onPress={() => router.push('/delete-account')} />
      </Card>
    </Screen>
  )
}

const styles = StyleSheet.create({
  lead: { fontSize: 15, lineHeight: 22 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
  flex: { flex: 1, fontSize: 16 },
  cardTitle: { fontSize: 17, fontWeight: '600' },
})
