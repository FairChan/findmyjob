import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useFormatter, useTranslations } from 'use-intl'

import { Button, Card, Chip, EmptyState, ErrorState, ListSkeleton, OfflineBanner, Screen, SectionTitle, Sheet, TopBar, useToast } from '@/components/ui'
import { useApplications, useTimeline, useWithdraw } from '@/features/applications/api'
import { useErrorMessage } from '@/i18n/error-message'
import { useOnline } from '@/lib/online'
import { useTheme } from '@/theme/use-theme'

/** S13 投递详情：状态时间线（不含企业内部备注）和撤回（二次确认） */
export default function ApplicationDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const toast = useToast()
  const online = useOnline()
  const format = useFormatter()
  const my = useTranslations('myApplications')
  const status = useTranslations('myApplications.status')
  const confirmT = useTranslations('withdrawConfirm')
  const t = useTranslations('mobile.applications')
  const common = useTranslations('mobile.common')
  const errorMessage = useErrorMessage()
  const { colors, radius } = useTheme()
  const applications = useApplications()
  const timeline = useTimeline(id)
  const withdraw = useWithdraw(id)
  const [confirming, setConfirming] = useState(false)

  const app = applications.data?.items.find((a) => a.id === id)

  let body
  if (applications.isPending || timeline.isPending) body = <ListSkeleton rows={2} />
  else if (applications.isError || timeline.isError)
    body = <ErrorState message={errorMessage(applications.error ?? timeline.error)} onRetry={() => void Promise.all([applications.refetch(), timeline.refetch()])} />
  else if (!app) body = <EmptyState title={t('notFound')} />
  else {
    const events = timeline.data?.events ?? []
    body = (
      <>
        <Card>
          <Text style={[styles.title, { color: colors.foreground }]}>{app.job.title}</Text>
          <Text style={{ color: colors.mutedForeground }}>{app.job.companyName}</Text>
          <View style={styles.row}>
            <Chip label={status(app.status)} />
            <Text style={{ color: colors.mutedForeground }}>
              {my('appliedAt')} {format.dateTime(new Date(app.createdAt), { dateStyle: 'medium' })}
            </Text>
          </View>
          <Button label={t('viewJob')} variant="ghost" onPress={() => router.push(`/jobs/${app.job.id}`)} />
        </Card>
        {app.coverNote ? (
          <>
            <SectionTitle>{my('coverNoteLabel')}</SectionTitle>
            <Text style={[styles.body, { color: colors.foreground }]}>{app.coverNote}</Text>
          </>
        ) : null}
        <SectionTitle>{my('timelineLabel')}</SectionTitle>
        <View testID="application-timeline" accessibilityRole="list" style={styles.timeline}>
          {events.map((e, i) => (
            <View key={e.id} style={styles.event} accessible accessibilityLabel={`${status(e.toStatus)}，${format.dateTime(new Date(e.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}`}>
              <View style={styles.rail}>
                <View style={[styles.dot, { backgroundColor: i === events.length - 1 ? colors.brand : colors.border, borderRadius: radius.pill }]} />
                {i < events.length - 1 ? <View style={[styles.line, { backgroundColor: colors.border }]} /> : null}
              </View>
              <View style={styles.eventBody}>
                <Text style={[styles.eventTitle, { color: colors.foreground }]}>{status(e.toStatus)}</Text>
                <Text style={{ color: colors.mutedForeground }}>{format.dateTime(new Date(e.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}</Text>
              </View>
            </View>
          ))}
        </View>
      </>
    )
  }

  const footer = app?.canWithdraw ? (
    <>
      {withdraw.isError ? <Text style={{ color: colors.destructive }}>{errorMessage(withdraw.error)}</Text> : null}
      <Button testID="withdraw" label={t('withdraw')} variant="secondary" disabled={!online} loading={withdraw.isPending} onPress={() => setConfirming(true)} fullWidth />
    </>
  ) : undefined

  return (
    <Screen footer={footer} onRefresh={() => void Promise.all([applications.refetch(), timeline.refetch()])} refreshing={applications.isRefetching || timeline.isRefetching}>
      <TopBar title={t('detailTitle')} />
      <OfflineBanner />
      {body}
      <Sheet open={confirming} onClose={() => setConfirming(false)} title={confirmT('title')} closeLabel={common('close')}>
        <Text style={[styles.body, { color: colors.foreground }]}>{confirmT('body')}</Text>
        <Button
          testID="withdraw-confirm"
          label={confirmT('confirm')}
          variant="destructive"
          fullWidth
          onPress={async () => {
            setConfirming(false)
            try {
              await withdraw.mutateAsync()
              toast(my('withdrawSuccess'))
            } catch {
              // 错误显示在底部按钮上方
            }
          }}
        />
        <Button label={confirmT('cancel')} variant="secondary" fullWidth onPress={() => setConfirming(false)} />
      </Sheet>
    </Screen>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  body: { fontSize: 16, lineHeight: 24 },
  timeline: { gap: 0 },
  event: { flexDirection: 'row', gap: 12, minHeight: 56 },
  rail: { alignItems: 'center', width: 16 },
  dot: { width: 12, height: 12, marginTop: 4 },
  line: { width: 2, flex: 1 },
  eventBody: { flex: 1, paddingBottom: 12, gap: 2 },
  eventTitle: { fontSize: 16, fontWeight: '500' },
})
