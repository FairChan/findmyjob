import type { MobileApplicationList, MobileInvitationList } from '@shared/mobile-api'
import { StyleSheet, Text, View } from 'react-native'
import { useFormatter, useLocale, useTranslations } from 'use-intl'

import { Button, Card, Chip } from '@/components/ui'
import { companyName, useJobLabels, useSalaryText } from '@/features/jobs/components'
import { useTheme } from '@/theme/use-theme'

type Application = MobileApplicationList['items'][number]
type Invitation = MobileInvitationList['items'][number]

export function ApplicationCard({ app, onPress }: { app: Application; onPress: () => void }) {
  const status = useTranslations('myApplications.status')
  const t = useTranslations('myApplications')
  const format = useFormatter()
  const { colors } = useTheme()
  const date = format.dateTime(new Date(app.createdAt), { dateStyle: 'medium' })
  return (
    <View testID={`application-${app.id}`}>
      <Card onPress={onPress} accessibilityLabel={`${app.job.title}，${app.job.companyName}，${status(app.status)}，${t('appliedAt')} ${date}`}>
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={2}>
          {app.job.title}
        </Text>
        <Text style={{ color: colors.mutedForeground }}>{app.job.companyName}</Text>
        <View style={styles.row}>
          <Chip label={status(app.status)} />
          <Text style={{ color: colors.mutedForeground }}>
            {t('appliedAt')} {date}
          </Text>
        </View>
      </Card>
    </View>
  )
}

export function isInvitationOpen(inv: Invitation, now = Date.now()): boolean {
  return inv.status === 'SENT' && new Date(inv.expiresAt).getTime() > now
}

/** S14 邀请卡片：待回复的给"接受并投递 / 婉拒"，其余只显示状态 */
export function InvitationCard({ inv, busy, onAccept, onDecline }: { inv: Invitation; busy: boolean; onAccept: () => void; onDecline: () => void }) {
  const t = useTranslations('invitations')
  const m = useTranslations('mobile.applications')
  const locale = useLocale()
  const format = useFormatter()
  const labels = useJobLabels()
  const salary = useSalaryText()
  const { colors } = useTheme()
  const open = isInvitationOpen(inv)
  const company = companyName(inv.company, locale)
  const expired = inv.status === 'EXPIRED' || (inv.status === 'SENT' && !open)
  const statusLabel = expired ? m('expired') : { SENT: t('statusSent'), ACCEPTED: t('statusAccepted'), DECLINED: t('statusDeclined'), EXPIRED: t('statusExpired') }[inv.status]
  return (
    <View testID={`invitation-${inv.id}`}>
      <Card>
        <Text style={[styles.title, { color: colors.foreground }]}>{inv.job ? t('companyInvites', { company, job: inv.job.title }) : company}</Text>
        {inv.job ? (
          <Text style={{ color: colors.mutedForeground }}>
            {[labels.type(inv.job.type), labels.workMode(inv.job.workMode), inv.job.city, salary(inv.job.salaryMin, inv.job.salaryMax)].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
        {inv.message ? <Text style={[styles.message, { color: colors.foreground, borderColor: colors.border }]}>{inv.message}</Text> : null}
        <View style={styles.row}>
          <Chip label={statusLabel} />
          {open ? <Text style={{ color: colors.mutedForeground }}>{t('expiresAt', { date: format.dateTime(new Date(inv.expiresAt), { dateStyle: 'medium' }) })}</Text> : null}
        </View>
        {open ? (
          <View style={styles.actions}>
            <Button testID={`invitation-decline-${inv.id}`} label={t('declineButton')} variant="secondary" onPress={onDecline} disabled={busy} />
            <View style={styles.flex}>
              <Button testID={`invitation-accept-${inv.id}`} label={t('acceptButton')} onPress={onAccept} loading={busy} fullWidth />
            </View>
          </View>
        ) : null}
      </Card>
    </View>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: '600', lineHeight: 23 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  message: { borderLeftWidth: 3, paddingLeft: 10, lineHeight: 21 },
  actions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  flex: { flex: 1 },
})
