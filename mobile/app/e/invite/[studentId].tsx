import { useLocalSearchParams, useRouter } from 'expo-router'
import { useState } from 'react'
import { Text } from 'react-native'
import { useTranslations } from 'use-intl'

import { Button, EmptyState, ErrorState, ListSkeleton, OfflineBanner, Screen, SelectField, TextField, TopBar, useToast } from '@/components/ui'
import { useCompanyInvitations, useEmployerJobs, useSendInvitation } from '@/features/employer/api'
import { useEmployerError } from '@/features/employer/errors'
import { useErrorMessage } from '@/i18n/error-message'
import { ApiError } from '@/lib/api-client'
import { useOnline } from '@/lib/online'
import { useTheme } from '@/theme/use-theme'

/** E07 邀请投递：选一个在招职位、可选留言；按 KL 自然月计额度，同一职位未过期的邀请幂等 */
export default function InviteCandidate() {
  const { studentId } = useLocalSearchParams<{ studentId: string }>()
  const router = useRouter()
  const toast = useToast()
  const online = useOnline()
  const t = useTranslations('mobile.employer')
  const inv = useTranslations('invitations')
  const errorMessage = useErrorMessage()
  const employerError = useEmployerError()
  const { colors } = useTheme()
  const jobs = useEmployerJobs()
  const invitations = useCompanyInvitations()
  const send = useSendInvitation()
  const [jobId, setJobId] = useState<string | null>(null)
  const [message, setMessage] = useState('')

  const published = jobs.data?.items.filter((j) => j.status === 'PUBLISHED') ?? []
  const usage = invitations.data?.usage

  function sendError(err: unknown): string {
    // 职位已关闭/截止，或学生已不可见：服务端是 404/422
    if (err instanceof ApiError && (err.status === 404 || err.status === 422)) return inv('inviteUnavailable')
    return employerError(err, 'invite')
  }

  async function submit() {
    if (!jobId) return
    try {
      const r = await send.mutateAsync({ studentId, jobId, message: message.trim() || null })
      toast(r.alreadyExists ? inv('inviteAlreadyExists') : inv('inviteSuccess'))
      router.back()
    } catch {
      // 原因显示在按钮上方
    }
  }

  let body
  if (jobs.isPending) body = <ListSkeleton rows={2} />
  else if (jobs.isError) body = <ErrorState message={errorMessage(jobs.error)} onRetry={() => void jobs.refetch()} />
  else if (!published.length) body = <EmptyState title={inv('inviteNoJobs')} />
  else
    body = (
      <>
        <SelectField
          testID="e-invite-job"
          label={inv('inviteDialogJobLabel')}
          placeholder={t('chooseJob')}
          value={jobId}
          options={published.map((j) => ({ value: j.id, label: j.title }))}
          onChange={setJobId}
        />
        <TextField
          testID="e-invite-message"
          label={inv('inviteDialogMessageLabel')}
          placeholder={inv('inviteDialogMessagePlaceholder')}
          value={message}
          onChangeText={setMessage}
          maxLength={500}
          multiline
          textAlignVertical="top"
          style={{ minHeight: 100, paddingTop: 12 }}
        />
      </>
    )

  return (
    <Screen
      footer={
        <>
          {send.isError ? (
            <Text testID="e-invite-error" accessibilityRole="alert" style={{ color: colors.destructive }}>
              {sendError(send.error)}
            </Text>
          ) : null}
          <Button testID="e-invite-send" label={inv('inviteDialogSubmit')} onPress={submit} loading={send.isPending} disabled={!jobId || !online} fullWidth />
        </>
      }
    >
      <TopBar title={inv('inviteDialogTitle')} />
      <OfflineBanner />
      {usage ? (
        <Text style={{ color: colors.mutedForeground }}>
          {usage.quota === null ? inv('inviteDialogQuotaUnlimited', { used: usage.used }) : inv('inviteDialogQuota', { used: usage.used, quota: usage.quota })}
        </Text>
      ) : null}
      {body}
    </Screen>
  )
}
