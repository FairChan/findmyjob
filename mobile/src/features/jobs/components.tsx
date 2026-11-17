import type { MobileJobListItem } from '@shared/mobile-api'
import { BadgeCheck, MapPin } from 'lucide-react-native'
import { useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useFormatter, useLocale, useTranslations } from 'use-intl'

import { Button, Card, ChipGroup, Sheet } from '@/components/ui'
import { MY_STATES, localized, stateLabel } from '@/lib/reference-data'
import { useTheme } from '@/theme/use-theme'
import type { JobFilters } from './api'

type CompanyRef = { legalName: string; displayNameZh: string | null; displayNameEn: string | null }

export function companyName(c: CompanyRef, locale: string): string {
  return (locale === 'en' ? c.displayNameEn : c.displayNameZh) ?? c.legalName
}

/** 薪资只在服务端给了数字时显示；隐藏薪资服务端已置 null，这里显示"面议"，绝不猜 */
export function useSalaryText() {
  const t = useTranslations('mobile.jobs')
  const format = useFormatter()
  return (min: number | null, max: number | null): string => {
    const n = (v: number) => format.number(v, { maximumFractionDigits: 0 })
    if (min !== null && max !== null) return t('salaryRange', { min: n(min), max: n(max) })
    if (min !== null) return t('salaryFrom', { min: n(min) })
    if (max !== null) return t('salaryUpTo', { max: n(max) })
    return t('salaryHidden')
  }
}

export function useJobLabels() {
  const t = useTranslations('jobs')
  const locale = useLocale()
  return {
    type: (v: string) => (['INTERNSHIP', 'FULL_TIME', 'PART_TIME'].includes(v) ? t(`type.${v}` as 'type.INTERNSHIP') : v),
    workMode: (v: string | null) => (v && ['ONSITE', 'HYBRID', 'REMOTE'].includes(v) ? t(`workMode.${v}` as 'workMode.ONSITE') : null),
    location: (state: string | null, city: string | null) => [city, stateLabel(state, locale)].filter(Boolean).join(' · ') || null,
  }
}

/** 列表卡片：整张卡一个 TalkBack 单元，读出职位、企业、地点、类型和薪资 */
export function JobCard({ job, onPress }: { job: MobileJobListItem; onPress: () => void }) {
  const locale = useLocale()
  const { colors } = useTheme()
  const labels = useJobLabels()
  const salary = useSalaryText()
  const t = useTranslations('mobile.jobs')
  const company = companyName(job.company, locale)
  const location = labels.location(job.state, job.city)
  const salaryText = salary(job.salaryMin, job.salaryMax)
  const meta = [labels.type(job.type), labels.workMode(job.workMode)].filter(Boolean).join(' · ')
  return (
    <View testID={`job-card-${job.id}`}>
      <Card onPress={onPress} accessibilityLabel={[job.title, company, t('verified'), location, meta, salaryText].filter(Boolean).join('，')}>
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={2}>
          {job.title}
        </Text>
        <View style={styles.row}>
          <Text style={[styles.company, { color: colors.foreground }]} numberOfLines={1}>
            {company}
          </Text>
          <BadgeCheck color={colors.brand} size={16} />
        </View>
        {location ? (
          <View style={styles.row}>
            <MapPin color={colors.mutedForeground} size={14} />
            <Text style={{ color: colors.mutedForeground }}>{location}</Text>
          </View>
        ) : null}
        <Text style={{ color: colors.mutedForeground }}>{meta}</Text>
        <Text style={[styles.salary, { color: colors.brand }]}>{salaryText}</Text>
      </Card>
    </View>
  )
}

const TYPES = ['INTERNSHIP', 'FULL_TIME', 'PART_TIME'] as const
const MODES = ['ONSITE', 'HYBRID', 'REMOTE'] as const
const SORTS = ['relevance', 'salary'] as const

/** S09 筛选抽屉：改动先存在草稿里，点"显示结果"才生效；单选维度再点一次取消 */
export function FilterSheet({ open, onClose, value, onApply }: {
  open: boolean
  onClose: () => void
  value: JobFilters
  onApply: (next: JobFilters) => void
}) {
  const t = useTranslations('mobile.jobs')
  const common = useTranslations('mobile.common')
  const pub = useTranslations('publicJobs.filters')
  const labels = useJobLabels()
  const locale = useLocale()
  const [draft, setDraft] = useState<JobFilters>(value)
  const [lastOpen, setLastOpen] = useState(open)
  // 每次打开都从当前生效的筛选开始
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) setDraft(value)
  }
  const pick = <K extends keyof JobFilters>(k: K, v: NonNullable<JobFilters[K]>) => setDraft((d) => ({ ...d, [k]: d[k] === v ? undefined : v }))

  return (
    <Sheet open={open} onClose={onClose} title={t('filters')} closeLabel={common('close')}>
      <ScrollView style={styles.sheetBody} contentContainerStyle={styles.sheetContent}>
        <ChipGroup testIDPrefix="filter-type" label={pub('type')} options={TYPES.map((v) => ({ value: v, label: labels.type(v) }))} selected={draft.type ? [draft.type] : []} onToggle={(v) => pick('type', v)} />
        <ChipGroup testIDPrefix="filter-mode" label={pub('workMode')} options={MODES.map((v) => ({ value: v, label: labels.workMode(v) ?? v }))} selected={draft.workMode ? [draft.workMode] : []} onToggle={(v) => pick('workMode', v)} />
        <ChipGroup testIDPrefix="filter-state" label={pub('state')} options={MY_STATES.map((s) => ({ value: s.code, label: localized(s, locale) }))} selected={draft.state ? [draft.state] : []} onToggle={(v) => pick('state', v)} />
        <ChipGroup testIDPrefix="filter-sort" label={t('sort')} options={SORTS.map((v) => ({ value: v, label: t(`sort_${v}`) }))} selected={[draft.sort ?? 'relevance']} onToggle={(v) => setDraft((d) => ({ ...d, sort: v === 'relevance' ? undefined : v }))} />
      </ScrollView>
      <View style={styles.sheetFooter}>
        <Button label={t('reset')} variant="secondary" onPress={() => setDraft({ q: value.q })} />
        <View style={styles.flex}>
          <Button
            testID="filter-apply"
            label={t('showResults')}
            fullWidth
            onPress={() => {
              onApply({ ...draft, q: value.q })
              onClose()
            }}
          />
        </View>
      </View>
    </Sheet>
  )
}

export function activeFilterCount(f: JobFilters): number {
  return [f.type, f.workMode, f.state, f.sort].filter(Boolean).length
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: '600', lineHeight: 23 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  company: { fontSize: 15, flexShrink: 1 },
  salary: { fontSize: 15, fontWeight: '600' },
  sheetBody: { flexGrow: 0 },
  sheetContent: { gap: 16, paddingBottom: 8 },
  sheetFooter: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  flex: { flex: 1 },
})
