import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useLocale, useTranslations } from 'use-intl'

import { Card, Chip, EmptyState, ErrorState, ListSkeleton, OfflineBanner, Screen, TopBar } from '@/components/ui'
import { COMPANY_TAGS, useCompanies, type CompanyTag } from '@/features/companies/api'
import { companyName } from '@/features/jobs/components'
import { useErrorMessage } from '@/i18n/error-message'
import { stateLabel } from '@/lib/reference-data'
import { useTheme } from '@/theme/use-theme'

/** S15 企业列表：只列已认证且有效的企业，按标签筛选 */
export default function Companies() {
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('publicCompanies')
  const browser = useTranslations('companyBrowser')
  const m = useTranslations('mobile.companies')
  const errorMessage = useErrorMessage()
  const { colors, radius } = useTheme()
  const [tag, setTag] = useState<CompanyTag | null>(null)
  const query = useCompanies(tag)
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data])

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <TopBar title={t('title')} />
        <OfflineBanner />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tags} accessibilityLabel={browser('filters')}>
          <Chip label={t('tagAll')} selected={tag === null} onPress={() => setTag(null)} />
          {COMPANY_TAGS.map((tg) => (
            <Chip key={tg} label={t(`tag${tg}` as 'tagALUMNI')} selected={tag === tg} onPress={() => setTag(tag === tg ? null : tg)} />
          ))}
        </ScrollView>
      </View>
      {query.isPending ? (
        <ListSkeleton />
      ) : query.isError && !items.length ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <FlatList
          testID="companies-list"
          data={items}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.content}
          ItemSeparatorComponent={Separator}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage()
          }}
          refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isFetchingNextPage} onRefresh={() => void query.refetch()} tintColor={colors.brand} colors={[colors.brand]} />}
          ListEmptyComponent={<EmptyState title={t('empty')} />}
          ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={colors.brand} style={styles.footer} /> : undefined}
          renderItem={({ item }) => {
            const name = companyName(item, locale)
            const place = [item.city, stateLabel(item.state, locale)].filter(Boolean).join(' · ')
            const jobs = browser('jobCount', { count: item.publishedJobCount })
            return (
              <View testID={`company-${item.id}`}>
                <Card onPress={() => router.push(`/companies/${item.id}`)} accessibilityLabel={[name, m('verified'), place, jobs].filter(Boolean).join('，')}>
                  <View style={styles.row}>
                    <View style={[styles.avatar, { backgroundColor: colors.brandMuted, borderRadius: radius.button }]}>
                      <Text style={[styles.avatarText, { color: colors.brandMutedForeground }]}>{name.slice(0, 1)}</Text>
                    </View>
                    <View style={styles.flex}>
                      <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={2}>
                        {name}
                      </Text>
                      {place ? <Text style={{ color: colors.mutedForeground }}>{place}</Text> : null}
                      <Text style={{ color: colors.brand }}>{jobs}</Text>
                    </View>
                  </View>
                </Card>
              </View>
            )
          }}
        />
      )}
    </Screen>
  )
}

function Separator() {
  return <View style={styles.sep} />
}

const styles = StyleSheet.create({
  header: { gap: 12, paddingTop: 8, paddingBottom: 12 },
  // chip 本身 36 高，上下各留 6 让 hitSlop 补到 48 不被裁
  tags: { gap: 8, paddingVertical: 6 },
  content: { paddingBottom: 24 },
  sep: { height: 12 },
  footer: { paddingVertical: 16 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  avatar: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 20, fontWeight: '700' },
  flex: { flex: 1, gap: 2 },
  name: { fontSize: 17, fontWeight: '600' },
})
