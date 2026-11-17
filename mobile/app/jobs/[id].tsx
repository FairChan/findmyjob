import type { MobileJobOpen, MobileJobPreview } from '@shared/mobile-api'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { BadgeCheck, Lock, Share2 } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, Share, StyleSheet, Text, View } from 'react-native'
import { useFormatter, useLocale, useTranslations } from 'use-intl'

import { Button, Card, ErrorState, ListSkeleton, OfflineBanner, Screen, SectionTitle, Sheet, TopBar } from '@/components/ui'
import { webUrl } from '@/features/auth/actions'
import { quotaExhausted, remaining, useJobPreview, useOpenJob, useOpenedJob } from '@/features/jobs/api'
import { companyName, useJobLabels, useSalaryText } from '@/features/jobs/components'
import { useErrorMessage } from '@/i18n/error-message'
import { useOnline } from '@/lib/online'
import { useTheme } from '@/theme/use-theme'

/**
 * S10 预览 → 详情。预览（GET /preview）不扣额度；只有用户点"查看完整详情"（扣额度时再点一次确认）
 * 才调用 POST /open。已看过、已投递、被邀请过或额度不限时 opensFree=true，直接打开不弹确认。
 */
export default function JobScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const open = useOpenJob(id)
  // 回到这个页面时（比如从投递页返回）沿用上次打开的结果，不再调用 open
  const opened = useOpenedJob(id)
  const result = opened.data ?? open.data

  if (result) return result.allowed && result.detail ? <Detail data={result} /> : <Locked title={result.job.title} />
  return <Preview id={id} open={open} />
}

function Preview({ id, open }: { id: string; open: ReturnType<typeof useOpenJob> }) {
  const t = useTranslations('mobile.jobs')
  const common = useTranslations('mobile.common')
  const errorMessage = useErrorMessage()
  const online = useOnline()
  const { colors } = useTheme()
  const preview = useJobPreview(id)
  const [confirming, setConfirming] = useState(false)

  if (preview.isPending) {
    return (
      <Screen>
        <TopBar title={t('previewTitle')} />
        <ListSkeleton rows={2} />
      </Screen>
    )
  }
  if (preview.isError) {
    return (
      <Screen>
        <TopBar title={t('previewTitle')} />
        <ErrorState message={errorMessage(preview.error)} onRetry={() => void preview.refetch()} />
      </Screen>
    )
  }
  const p = preview.data
  if (!p.opensFree && quotaExhausted(p.quota)) return <Locked title={p.job.title} />
  const left = remaining(p.quota)
  const free = p.opensFree || left === null

  const footer = (
    <>
      {open.isError ? (
        <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
          {errorMessage(open.error)}
        </Text>
      ) : null}
      {!online ? <Text style={{ color: colors.mutedForeground }}>{common('offlineAction')}</Text> : null}
      <Button
        testID="job-view-detail"
        label={free ? t('viewDetailFree') : t('viewDetail', { count: left ?? 0 })}
        loading={open.isPending}
        disabled={!online}
        fullWidth
        onPress={() => (free ? open.mutate() : setConfirming(true))}
      />
    </>
  )

  return (
    <Screen footer={footer}>
      <TopBar title={t('previewTitle')} />
      <OfflineBanner />
      <JobSummary job={p.job} />
      <Text style={{ color: colors.mutedForeground, lineHeight: 21 }}>{t('previewHint')}</Text>
      <Sheet open={confirming} onClose={() => setConfirming(false)} title={t('openConfirmTitle')} closeLabel={common('close')}>
        <Text testID="open-confirm-body" style={[styles.body, { color: colors.foreground }]}>
          {t('openConfirmBody', { count: left ?? 0 })}
        </Text>
        <Button
          testID="open-confirm"
          label={common('confirm')}
          fullWidth
          onPress={() => {
            setConfirming(false)
            open.mutate()
          }}
        />
        <Button label={common('cancel')} variant="secondary" fullWidth onPress={() => setConfirming(false)} />
      </Sheet>
    </Screen>
  )
}

/** 预览和详情共用的头部：职位名、企业（认证徽章）、地点、类型、薪资（公开才有数字） */
function JobSummary({ job }: { job: MobileJobPreview['job'] }) {
  const router = useRouter()
  const locale = useLocale()
  const t = useTranslations('mobile.jobs')
  const { colors } = useTheme()
  const labels = useJobLabels()
  const salary = useSalaryText()
  const company = companyName(job.company, locale)
  return (
    <View style={styles.summary}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
        {job.title}
      </Text>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${company}，${t('verified')}`}
        onPress={() => router.push(`/companies/${job.company.id}`)}
        style={styles.companyRow}
      >
        <Text style={[styles.company, { color: colors.brand }]}>{company}</Text>
        <BadgeCheck color={colors.brand} size={18} />
      </Pressable>
      <Text style={{ color: colors.mutedForeground }}>
        {[labels.location(job.state, job.city), labels.type(job.type), labels.workMode(job.workMode)].filter(Boolean).join(' · ')}
      </Text>
      <Text style={[styles.salary, { color: colors.brand }]}>{salary(job.salaryMin, job.salaryMax)}</Text>
    </View>
  )
}

function Detail({ data }: { data: MobileJobOpen }) {
  const router = useRouter()
  const locale = useLocale()
  const format = useFormatter()
  const t = useTranslations('mobile.jobs')
  const facts = useTranslations('publicJobs.facts')
  const pub = useTranslations('publicJobs')
  const status = useTranslations('myApplications.status')
  const { colors } = useTheme()
  const d = data.detail!
  const app = data.application

  const factRows: [string, string | null][] = [
    [facts('deadline'), d.deadline ? format.dateTime(new Date(d.deadline), { dateStyle: 'medium' }) : null],
    [facts('headcount'), d.headcount ? facts('headcountValue', { count: d.headcount }) : null],
    [facts('languages'), d.languages.length ? d.languages.join(', ') : null],
    [facts('skills'), d.skills.length ? d.skills.join(', ') : null],
    [facts('studentPass'), d.acceptsStudentPass ? t('yes') : null],
    [facts('workPass'), d.sponsorsWorkPass ? t('yes') : null],
  ]

  const footer = app ? (
    <Button testID="job-view-application" label={`${t('applied')} · ${status(app.status)}`} variant="secondary" fullWidth onPress={() => router.push(`/applications/${app.id}`)} />
  ) : (
    <Button testID="job-apply" label={t('apply')} fullWidth onPress={() => router.push(`/apply/${d.id}`)} />
  )

  return (
    <Screen footer={footer}>
      <TopBar
        title={t('detailTitle')}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('share')}
            onPress={() => void Share.share({ message: `${d.title} · ${companyName(d.company, locale)}\n${webUrl(`/${locale}/jobs/${d.id}`)}` })}
            style={styles.shareBtn}
          >
            <Share2 color={colors.foreground} size={22} />
          </Pressable>
        }
      />
      <View testID="job-detail">
        <JobSummary job={d} />
      </View>
      <Card>
        {factRows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <View key={k} style={styles.fact} accessible accessibilityLabel={`${k}: ${v}`}>
              <Text style={[styles.factKey, { color: colors.mutedForeground }]}>{k}</Text>
              <Text style={[styles.factValue, { color: colors.foreground }]}>{v}</Text>
            </View>
          ))}
      </Card>
      <SectionTitle>{pub('descriptionLabel')}</SectionTitle>
      <Text style={[styles.body, { color: colors.foreground }]}>{d.description}</Text>
      {d.requirements ? (
        <>
          <SectionTitle>{pub('requirementsLabel')}</SectionTitle>
          <Text style={[styles.body, { color: colors.foreground }]}>{d.requirements}</Text>
        </>
      ) : null}
      {d.benefits ? (
        <>
          <SectionTitle>{pub('benefitsLabel')}</SectionTitle>
          <Text style={[styles.body, { color: colors.foreground }]}>{d.benefits}</Text>
        </>
      ) : null}
    </Screen>
  )
}

/** 额度用完：和 Web 的锁定卡片一致，引导邀请同学（S19） */
function Locked({ title }: { title: string }) {
  const router = useRouter()
  const pub = useTranslations('publicJobs')
  const t = useTranslations('mobile.jobs')
  const { colors } = useTheme()
  return (
    <Screen>
      <TopBar title={t('previewTitle')} />
      <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
      <Card>
        <View style={styles.companyRow}>
          <Lock color={colors.foreground} size={20} />
          <Text testID="job-locked" accessibilityRole="header" style={[styles.lockedTitle, { color: colors.foreground }]}>
            {pub('lockedTitle')}
          </Text>
        </View>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>{pub('lockedDesc')}</Text>
        <Button testID="job-locked-invite" label={pub('inviteButton')} onPress={() => router.push('/invite')} />
      </Card>
    </Screen>
  )
}

const styles = StyleSheet.create({
  summary: { gap: 6 },
  title: { fontSize: 24, fontWeight: '700', lineHeight: 31 },
  companyRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48 },
  company: { fontSize: 16, fontWeight: '600', flexShrink: 1 },
  salary: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 24 },
  fact: { flexDirection: 'row', gap: 12, paddingVertical: 4 },
  factKey: { width: 110, fontSize: 15 },
  factValue: { flex: 1, fontSize: 15 },
  lockedTitle: { fontSize: 18, fontWeight: '600', flex: 1 },
  shareBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
})
