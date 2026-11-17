import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { Button, ChipGroup, EmptyState, OfflineBanner, Screen, Sheet, TextField } from '@/components/ui'
import { useTalentSearch, useTalentSearchResults, type TalentFilters } from '@/features/employer/api'
import { TalentCard } from '@/features/employer/components'
import { useEmployerError } from '@/features/employer/errors'
import { useOnline } from '@/lib/online'
import { useTheme } from '@/theme/use-theme'

const SORTS = ['lastActive', 'completeness', 'graduationYear'] as const
const DEGREES = ['FOUNDATION', 'DIPLOMA', 'BACHELOR', 'MASTER', 'PHD'] as const
const INTENTS = ['INTERNSHIP', 'FULL_TIME', 'PART_TIME'] as const
const WORK_AUTHS = ['MY_CITIZEN', 'MY_PR', 'STUDENT_PASS', 'DEPENDANT_PASS', 'NEEDS_WORK_PASS', 'OTHER'] as const

/**
 * E05 人才库搜索。每次调用 /e/talent 计一页（limits.searchPagesPerDay），所以：
 * 进入页面不搜索、不下拉刷新、不滑到底自动翻页；只有点"搜索"或"下一页"才发请求，按钮上写明会计数。
 */
export default function TalentSearch() {
  const router = useRouter()
  const online = useOnline()
  const t = useTranslations('mobile.employer')
  const ts = useTranslations('talentSearch')
  const common = useTranslations('mobile.common')
  const employerError = useEmployerError()
  const { colors } = useTheme()
  const results = useTalentSearchResults()
  const search = useTalentSearch()
  const [keyword, setKeyword] = useState(results.data?.filters.keyword ?? '')
  const [filters, setFilters] = useState<TalentFilters>(results.data?.filters ?? {})
  const [sheetOpen, setSheetOpen] = useState(false)

  const pages = useMemo(() => results.data?.pages ?? [], [results.data])
  // 翻页期间人才库数据可能变化，相邻两页偶尔会出现同一个人：按 id 去重
  const items = useMemo(() => [...new Map(pages.flatMap((p) => p.items).map((c) => [c.id, c])).values()], [pages])
  const last = pages[pages.length - 1]
  const csv = (v: string | undefined) => (v ? v.split(',') : [])
  const toggleCsv = (v: string | undefined, x: string) => {
    const list = csv(v)
    const next = list.includes(x) ? list.filter((y) => y !== x) : [...list, x]
    return next.length ? next.join(',') : undefined
  }

  function run(cursor?: string) {
    const base = cursor && results.data ? results.data.filters : { ...filters, keyword: keyword.trim() || undefined }
    search.mutate({ filters: base, cursor })
  }

  const labelOf = {
    sort: (v: (typeof SORTS)[number]) => ts({ lastActive: 'sortLastActive', completeness: 'sortCompleteness', graduationYear: 'sortGraduationYear' }[v] as 'sortLastActive'),
    degree: (v: (typeof DEGREES)[number]) => ts(`degreeLevel${v.charAt(0)}${v.slice(1).toLowerCase()}` as 'degreeLevelBachelor'),
    intent: (v: (typeof INTENTS)[number]) => ts({ INTERNSHIP: 'intentInternship', FULL_TIME: 'intentFullTime', PART_TIME: 'intentPartTime' }[v] as 'intentInternship'),
    workAuth: (v: (typeof WORK_AUTHS)[number]) =>
      ts(({ MY_CITIZEN: 'workAuthMyCitizen', MY_PR: 'workAuthMyPr', STUDENT_PASS: 'workAuthStudentPass', DEPENDANT_PASS: 'workAuthDependantPass', NEEDS_WORK_PASS: 'workAuthNeedsWorkPass', OTHER: 'workAuthOther' })[v] as 'workAuthOther'),
  }

  const header = (
    <View style={styles.header}>
      <Text accessibilityRole="header" style={[styles.h1, { color: colors.foreground }]}>
        {ts('title')}
      </Text>
      <OfflineBanner />
      <TextField
        testID="e-talent-keyword"
        label={ts('keywordLabel')}
        placeholder={ts('keywordPlaceholder')}
        value={keyword}
        onChangeText={setKeyword}
        returnKeyType="search"
        // 只有按下搜索键（输入法已上屏）才搜，打字过程中不发请求
        onSubmitEditing={() => run()}
        maxLength={100}
      />
      <View style={styles.row}>
        <Button label={ts('filterButton')} variant="secondary" onPress={() => setSheetOpen(true)} />
        <View style={styles.flex}>
          <Button testID="e-talent-search" label={t('searchCounts')} onPress={() => run()} loading={search.isPending && !search.variables?.cursor} disabled={!online || search.isPending} fullWidth />
        </View>
      </View>
      {search.isError ? (
        <Text testID="e-talent-error" accessibilityRole="alert" style={{ color: colors.destructive, lineHeight: 21 }}>
          {employerError(search.error, 'search')}
        </Text>
      ) : null}
      {last ? <Text style={{ color: colors.mutedForeground }}>{t('talentTotal', { total: last.total, pages: pages.length, maxPage: last.maxPage })}</Text> : null}
    </View>
  )

  return (
    <Screen scroll={false}>
      <FlatList
        testID="e-talent-list"
        data={items}
        keyExtractor={(c) => c.id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={Separator}
        renderItem={({ item }) => <TalentCard testID={`e-talent-${item.id}`} card={item} onPress={() => router.push(`/e/candidate/${item.id}`)} />}
        ListEmptyComponent={results.data ? <EmptyState title={ts('noResults')} /> : <EmptyState title={t('talentIntroTitle')} body={t('talentIntroBody')} />}
        ListFooterComponent={
          last?.nextCursor ? (
            <View style={styles.footer}>
              <Button
                testID="e-talent-next"
                label={t('nextPageCounts')}
                variant="secondary"
                loading={search.isPending && !!search.variables?.cursor}
                disabled={!online || search.isPending}
                onPress={() => run(last.nextCursor!)}
              />
            </View>
          ) : undefined
        }
      />
      <Sheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={ts('filterTitle')} closeLabel={common('close')}>
        <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheet}>
          <ChipGroup label={ts('sortLabel')} options={SORTS.map((v) => ({ value: v, label: labelOf.sort(v) }))} selected={[filters.sort ?? 'lastActive']} onToggle={(v) => setFilters((f) => ({ ...f, sort: v === 'lastActive' ? undefined : v }))} />
          <ChipGroup label={ts('degreeLevelLabel')} options={DEGREES.map((v) => ({ value: v, label: labelOf.degree(v) }))} selected={filters.degreeLevel ? [filters.degreeLevel] : []} onToggle={(v) => setFilters((f) => ({ ...f, degreeLevel: f.degreeLevel === v ? undefined : v }))} />
          <ChipGroup testIDPrefix="e-intent" label={ts('intentsLabel')} options={INTENTS.map((v) => ({ value: v, label: labelOf.intent(v) }))} selected={csv(filters.intents) as (typeof INTENTS)[number][]} onToggle={(v) => setFilters((f) => ({ ...f, intents: toggleCsv(f.intents, v) }))} />
          <ChipGroup label={ts('workAuthLabel')} options={WORK_AUTHS.map((v) => ({ value: v, label: labelOf.workAuth(v) }))} selected={csv(filters.workAuths) as (typeof WORK_AUTHS)[number][]} onToggle={(v) => setFilters((f) => ({ ...f, workAuths: toggleCsv(f.workAuths, v) }))} />
        </ScrollView>
        <View style={styles.row}>
          <Button label={ts('clearFilters')} variant="secondary" onPress={() => setFilters({})} />
          <View style={styles.flex}>
            <Button testID="e-talent-filter-done" label={common('done')} fullWidth onPress={() => setSheetOpen(false)} />
          </View>
        </View>
      </Sheet>
    </Screen>
  )
}

function Separator() {
  return <View style={styles.sep} />
}

const styles = StyleSheet.create({
  header: { gap: 12, paddingTop: 16, paddingBottom: 12 },
  h1: { fontSize: 28, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  flex: { flex: 1 },
  content: { paddingBottom: 24 },
  sep: { height: 12 },
  footer: { paddingVertical: 16 },
  sheetScroll: { flexGrow: 0 },
  sheet: { gap: 16, paddingBottom: 8 },
})
