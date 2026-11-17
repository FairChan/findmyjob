import { useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text } from 'react-native'
import { useFormatter, useTranslations } from 'use-intl'

import { Button, Card, Chip, OfflineBanner, Screen, SectionTitle, SelectField, Sheet, TextField, TopBar, useToast } from '@/components/ui'
import { SETTABLE_STATUSES, findApplicantCard, useApplicantCache, useChangeStatus, useMarkViewed, useViewApplicant, type SettableStatus } from '@/features/employer/api'
import { TalentDetailSections, TalentSummary, useApplicationStatusLabel } from '@/features/employer/components'
import { useEmployerError } from '@/features/employer/errors'
import { useOnline } from '@/lib/online'
import { useSecureScreen } from '@/lib/secure-screen'
import { useTheme } from '@/theme/use-theme'

/**
 * E04 候选人详情。GET /e/applications/:id 与 Web 看板点开候选人一样走 viewTalentProfile（计每日查看上限），
 * 所以进页面只显示列表里已有的卡片，用户点"查看完整档案"才请求；结果只放内存缓存，不自动重取。
 * 可以改投递状态（二次确认）。页面在屏幕上时开 FLAG_SECURE（MA4-T03）。
 */
export default function ApplicantDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  useSecureScreen(`applicant-${id}`)
  const router = useRouter()
  const queryClient = useQueryClient()
  const toast = useToast()
  const online = useOnline()
  const format = useFormatter()
  const t = useTranslations('mobile.employer')
  const ap = useTranslations('applicants')
  const common = useTranslations('mobile.common')
  const statusLabel = useApplicationStatusLabel()
  const employerError = useEmployerError()
  const { colors } = useTheme()
  const cached = useApplicantCache(id)
  const view = useViewApplicant(id)
  const change = useChangeStatus(id)
  const viewed = useMarkViewed(id)
  const [next, setNext] = useState<SettableStatus | null>(null)
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState(false)
  const d = cached.data ?? view.data

  // 详情加载后标记已查看（APPLIED → VIEWED，其余是 no-op），每个页面只调一次
  const marked = useRef(false)
  useEffect(() => {
    if (!d || marked.current) return
    marked.current = true
    if (d.status === 'APPLIED') viewed.mutate()
  }, [d, viewed])

  if (!d) {
    const item = findApplicantCard(queryClient, id)
    return (
      <Screen
        footer={
          <>
            {view.isError ? (
              <Text testID="e-applicant-error" accessibilityRole="alert" style={{ color: colors.destructive, lineHeight: 21 }}>
                {employerError(view.error, 'view')}
              </Text>
            ) : null}
            {!online ? <Text style={{ color: colors.mutedForeground }}>{common('offlineAction')}</Text> : null}
            <Button testID="e-applicant-view" label={t('viewProfileCounts')} onPress={() => view.mutate()} loading={view.isPending} disabled={!online} fullWidth />
          </>
        }
      >
        <TopBar title={t('applicantTitle')} />
        <OfflineBanner />
        {item ? (
          <Card>
            <TalentSummary card={item.card} />
            <Chip label={statusLabel(item.status)} />
          </Card>
        ) : null}
        <Text style={{ color: colors.mutedForeground, lineHeight: 21 }}>{t('viewProfileHint')}</Text>
      </Screen>
    )
  }

  const options = SETTABLE_STATUSES.filter((s) => s !== d.status).map((s) => ({ value: s, label: statusLabel(s) }))
  const finalState = d.status === 'WITHDRAWN'

  return (
    <Screen
      footer={
        !finalState ? (
          <Button testID="e-status-change" label={ap('changeStatusLabel')} disabled={!next || !online || change.isPending} loading={change.isPending} onPress={() => setConfirming(true)} fullWidth />
        ) : undefined
      }
    >
      <TopBar title={t('applicantTitle')} />
      <OfflineBanner />
      <Card>
        <TalentSummary card={d.profile} />
        <Chip label={statusLabel(d.status)} />
        <Text style={{ color: colors.mutedForeground }}>{t('appliedOn', { date: format.dateTime(new Date(d.createdAt), { dateStyle: 'medium' }) })}</Text>
      </Card>
      {d.coverNote ? (
        <>
          <SectionTitle>{ap('coverNoteLabel')}</SectionTitle>
          <Text style={[styles.body, { color: colors.foreground }]}>{d.coverNote}</Text>
        </>
      ) : null}
      {d.companyNote ? (
        <>
          <SectionTitle>{ap('noteLabel')}</SectionTitle>
          <Text style={[styles.body, { color: colors.foreground }]}>{d.companyNote}</Text>
        </>
      ) : null}
      <TalentDetailSections detail={d.profile} />
      {!d.profile.unlocked ? (
        <Card>
          <Text style={{ color: colors.mutedForeground, lineHeight: 21 }}>{t('contactAfterUnlock')}</Text>
          <Button testID="e-applicant-open-talent" label={t('openTalentProfile')} variant="secondary" onPress={() => router.push(`/e/candidate/${d.profile.id}`)} />
        </Card>
      ) : null}

      {!finalState ? (
        <>
          <SelectField testID="e-status-select" label={ap('changeStatusLabel')} value={next} options={options} onChange={(v) => setNext(v)} placeholder={t('chooseStatus')} />
          <TextField label={ap('noteLabel')} placeholder={ap('notePlaceholder')} value={note} onChangeText={setNote} maxLength={2000} multiline textAlignVertical="top" style={styles.multiline} />
        </>
      ) : null}
      {change.isError ? (
        <Text accessibilityRole="alert" style={{ color: colors.destructive }}>
          {employerError(change.error, 'status')}
        </Text>
      ) : null}

      <Sheet open={confirming} onClose={() => setConfirming(false)} title={next ? ap('confirmStatusTitle', { status: statusLabel(next) }) : ap('changeStatusLabel')} closeLabel={common('close')}>
        <Text style={[styles.body, { color: colors.foreground }]}>{ap('confirmStatusBody')}</Text>
        <Button
          testID="e-status-confirm"
          label={ap('confirmStatusAction')}
          fullWidth
          onPress={() => {
            setConfirming(false)
            if (!next) return
            change.mutate(
              { toStatus: next, note: note.trim() || null },
              {
                onSuccess: () => {
                  toast(t('statusChanged'))
                  setNext(null)
                  setNote('')
                },
              },
            )
          }}
        />
        <Button label={common('cancel')} variant="secondary" fullWidth onPress={() => setConfirming(false)} />
      </Sheet>
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { fontSize: 16, lineHeight: 24 },
  multiline: { minHeight: 90, paddingTop: 12 },
})
