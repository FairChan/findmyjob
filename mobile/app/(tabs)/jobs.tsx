import { useRouter } from 'expo-router'
import { Building2, Search, SlidersHorizontal } from 'lucide-react-native'
import { useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { Button, EmptyState, ErrorState, ListSkeleton, OfflineBanner, Screen } from '@/components/ui'
import { useJobs, type JobFilters } from '@/features/jobs/api'
import { FilterSheet, JobCard, activeFilterCount } from '@/features/jobs/components'
import { useSettledSearch } from '@/features/jobs/search'
import { useErrorMessage } from '@/i18n/error-message'
import { useTheme } from '@/theme/use-theme'

/** S08 职位列表 + S09 筛选。列表和翻页都不扣额度；点卡片进预览（也不扣） */
export default function JobsTab() {
  const router = useRouter()
  const t = useTranslations('mobile.jobs')
  const errorMessage = useErrorMessage()
  const { colors, radius, minTouchTarget } = useTheme()
  const [text, setText] = useState('')
  const [filters, setFilters] = useState<JobFilters>({})
  const [sheetOpen, setSheetOpen] = useState(false)
  // 输入停顿后（且不在组字中）或按下搜索键时才更新关键词
  const [settled, flushSearch] = useSettledSearch(text)
  const active: JobFilters = { ...filters, q: settled.trim() || undefined }

  const query = useJobs(active)
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data])
  const nFilters = activeFilterCount(active)

  const header = (
    <View style={styles.header}>
      <View style={styles.searchRow}>
        <View style={[styles.search, { borderColor: colors.border, borderRadius: radius.button, minHeight: minTouchTarget }]}>
          <Search color={colors.mutedForeground} size={20} />
          <TextInput
            testID="jobs-search"
            accessibilityLabel={t('searchPlaceholder')}
            placeholder={t('searchPlaceholder')}
            placeholderTextColor={colors.mutedForeground}
            value={text}
            onChangeText={setText}
            returnKeyType="search"
            onSubmitEditing={(e) => flushSearch(e.nativeEvent.text)}
            maxLength={100}
            style={[styles.input, { color: colors.foreground }]}
          />
        </View>
        <Pressable
          testID="jobs-filter"
          accessibilityRole="button"
          accessibilityLabel={nFilters ? `${t('filters')} (${nFilters})` : t('filters')}
          onPress={() => setSheetOpen(true)}
          style={[styles.iconButton, { width: minTouchTarget, height: minTouchTarget, borderColor: nFilters ? colors.brand : colors.border, borderRadius: radius.button }]}
        >
          <SlidersHorizontal color={nFilters ? colors.brand : colors.foreground} size={20} />
        </Pressable>
        <Pressable
          testID="jobs-companies"
          accessibilityRole="button"
          accessibilityLabel={t('companies')}
          onPress={() => router.push('/companies')}
          style={[styles.iconButton, { width: minTouchTarget, height: minTouchTarget, borderColor: colors.border, borderRadius: radius.button }]}
        >
          <Building2 color={colors.foreground} size={20} />
        </Pressable>
      </View>
      <OfflineBanner />
    </View>
  )

  let body
  if (query.isPending) body = <ListSkeleton />
  else if (query.isError && items.length === 0) body = <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />

  // 搜索栏固定在列表上方、不放进 FlatList 的 header：加载态切换时输入框不会重建，键盘和组字不被打断
  return (
    <Screen scroll={false}>
      {header}
      {body ?? (
        <FlatList
          testID="jobs-list"
          data={items}
          keyExtractor={(j) => j.id}
          renderItem={({ item }) => <JobCard job={item} onPress={() => router.push(`/jobs/${item.id}`)} />}
          ItemSeparatorComponent={Separator}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage()
          }}
          refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isFetchingNextPage} onRefresh={() => void query.refetch()} tintColor={colors.brand} colors={[colors.brand]} />}
          ListEmptyComponent={
            <EmptyState
              title={t('empty')}
              body={t('emptyHint')}
              action={nFilters || active.q ? <Button label={t('clearFilters')} variant="secondary" onPress={() => { setText(''); flushSearch(''); setFilters({}) }} /> : undefined}
            />
          }
          ListFooterComponent={
            query.isFetchingNextPage ? (
              <ActivityIndicator color={colors.brand} style={styles.footer} />
            ) : query.isError ? (
              <Text style={[styles.footer, { color: colors.destructive, textAlign: 'center' }]}>{errorMessage(query.error)}</Text>
            ) : undefined
          }
        />
      )}
      <FilterSheet open={sheetOpen} onClose={() => setSheetOpen(false)} value={active} onApply={({ q: _q, ...rest }) => setFilters(rest)} />
    </Screen>
  )
}

function Separator() {
  return <View style={styles.sep} />
}

const styles = StyleSheet.create({
  header: { gap: 12, paddingTop: 16, paddingBottom: 12 },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: StyleSheet.hairlineWidth * 2, paddingHorizontal: 12 },
  input: { flex: 1, fontSize: 16, paddingVertical: 8 },
  iconButton: { alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth * 2 },
  content: { paddingBottom: 24 },
  sep: { height: 12 },
  footer: { paddingVertical: 16 },
})
