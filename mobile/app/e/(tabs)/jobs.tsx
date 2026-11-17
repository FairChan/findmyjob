import { useRouter } from 'expo-router'
import { useState } from 'react'
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useFormatter, useTranslations } from 'use-intl'

import { Button, Card, Chip, EmptyState, ErrorState, ListSkeleton, OfflineBanner, Screen, Sheet, useToast } from '@/components/ui'
import { useCloseJob, useEmployerJobs } from '@/features/employer/api'
import { useEmployerError } from '@/features/employer/errors'
import { useJobLabels } from '@/features/jobs/components'
import { useErrorMessage } from '@/i18n/error-message'
import { useOnline } from '@/lib/online'
import { useTheme } from '@/theme/use-theme'

/** E02 职位列表：状态、投递数；已发布的可以关闭（二次确认）。新建和编辑职位只在网页版 */
export default function EmployerJobs() {
  const router = useRouter()
  const toast = useToast()
  const online = useOnline()
  const format = useFormatter()
  const t = useTranslations('mobile.employer')
  const jt = useTranslations('jobs')
  const common = useTranslations('mobile.common')
  const errorMessage = useErrorMessage()
  const employerError = useEmployerError()
  const labels = useJobLabels()
  const { colors } = useTheme()
  const jobs = useEmployerJobs()
  const close = useCloseJob()
  const [closing, setClosing] = useState<{ id: string; title: string } | null>(null)

  let body
  if (jobs.isPending) body = <ListSkeleton />
  else if (jobs.isError) body = <ErrorState message={errorMessage(jobs.error)} onRetry={() => void jobs.refetch()} />
  else
    body = (
      <FlatList
        testID="e-jobs-list"
        data={jobs.data.items}
        keyExtractor={(j) => j.id}
        contentContainerStyle={styles.content}
        ItemSeparatorComponent={Separator}
        refreshControl={<RefreshControl refreshing={jobs.isRefetching} onRefresh={() => void jobs.refetch()} tintColor={colors.brand} colors={[colors.brand]} />}
        ListEmptyComponent={<EmptyState title={t('noJobs')} body={t('createOnWeb')} />}
        renderItem={({ item }) => {
          const status = jt(`status.${item.status}` as 'status.DRAFT')
          const meta = [labels.type(item.type), labels.workMode(item.workMode), labels.location(item.state, item.city)].filter(Boolean).join(' · ')
          return (
            <View testID={`e-job-${item.id}`}>
              <Card onPress={() => router.push(`/e/job/${item.id}`)} accessibilityLabel={[item.title, status, t('applicationCount', { count: item.applicationCount })].join('，')}>
                <Text style={[styles.title, { color: colors.foreground }]}>{item.title}</Text>
                <Text style={{ color: colors.mutedForeground }}>{meta}</Text>
                <View style={styles.row}>
                  <Chip label={status} />
                  <Text style={{ color: colors.foreground }}>{t('applicationCount', { count: item.applicationCount })}</Text>
                  {item.deadline ? <Text style={{ color: colors.mutedForeground }}>{t('deadline', { date: format.dateTime(new Date(item.deadline), { dateStyle: 'medium' }) })}</Text> : null}
                </View>
              </Card>
              {item.status === 'PUBLISHED' ? (
                <Button
                  testID={`e-job-close-${item.id}`}
                  label={t('closeJob')}
                  variant="ghost"
                  accessibilityLabel={`${t('closeJob')} ${item.title}`}
                  disabled={!online || close.isPending}
                  onPress={() => setClosing({ id: item.id, title: item.title })}
                />
              ) : null}
            </View>
          )
        }}
      />
    )

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[styles.h1, { color: colors.foreground }]}>
          {t('tabs.jobs')}
        </Text>
        <OfflineBanner />
      </View>
      {body}
      <Sheet open={closing !== null} onClose={() => setClosing(null)} title={t('closeJob')} closeLabel={common('close')}>
        <Text style={{ color: colors.foreground, lineHeight: 22 }}>{jt('confirmClose')}</Text>
        <Text style={{ color: colors.mutedForeground }}>{closing?.title}</Text>
        <Button
          testID="e-job-close-confirm"
          label={t('closeJob')}
          variant="destructive"
          fullWidth
          onPress={() => {
            const target = closing
            setClosing(null)
            if (target)
              close.mutate(target.id, {
                onSuccess: () => toast(jt('closeSuccess')),
                onError: (err) => toast(employerError(err, 'general'), 'error'),
              })
          }}
        />
        <Button label={common('cancel')} variant="secondary" fullWidth onPress={() => setClosing(null)} />
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
  content: { paddingBottom: 24 },
  sep: { height: 12 },
  title: { fontSize: 17, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
})
