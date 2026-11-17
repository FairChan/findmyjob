import { Share2 } from 'lucide-react-native'
import { Share, StyleSheet, Text, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { Button, Card, Chip, EmptyState, ErrorState, ListSkeleton, OfflineBanner, Screen, SectionTitle, TopBar } from '@/components/ui'
import { useReferrals } from '@/features/referrals/api'
import { useErrorMessage } from '@/i18n/error-message'
import { useTheme } from '@/theme/use-theme'

/** S19 邀请同学：邀请码 + 系统分享（WhatsApp、微信、复制都在系统分享面板里）、解锁进度 */
export default function Invite() {
  const t = useTranslations('invite')
  const m = useTranslations('mobile.invite')
  const errorMessage = useErrorMessage()
  const { colors, radius } = useTheme()
  const referrals = useReferrals()

  if (referrals.isPending)
    return (
      <Screen>
        <TopBar title={t('title')} />
        <ListSkeleton rows={2} />
      </Screen>
    )
  if (referrals.isError)
    return (
      <Screen>
        <TopBar title={t('title')} />
        <ErrorState message={errorMessage(referrals.error)} onRetry={() => void referrals.refetch()} />
      </Screen>
    )

  const r = referrals.data
  const { quota } = r
  const unlimited = quota.limit === null
  const next = unlimited ? t('alreadyUnlimited') : quota.next === r.unlimitedAt - quota.qualified ? t('nextUnlimited', { count: quota.next }) : t('nextTier', { count: quota.next, bonus: r.tierBonus })
  const status = { PENDING: t('statusPending'), QUALIFIED: t('statusQualified'), VOID: t('statusVoid') }

  return (
    <Screen
      onRefresh={() => void referrals.refetch()}
      refreshing={referrals.isRefetching}
      footer={
        <Button
          testID="invite-share"
          label={m('share')}
          icon={<Share2 color={colors.brandForeground} size={18} />}
          fullWidth
          onPress={() => void Share.share({ message: m('shareMessage', { code: r.code, link: r.inviteLink }) })}
        />
      }
    >
      <TopBar title={t('title')} />
      <OfflineBanner />
      <Card>
        <Text style={{ color: colors.mutedForeground }}>{m('codeLabel')}</Text>
        <Text testID="invite-code" selectable accessibilityLabel={`${m('codeLabel')} ${r.code.split('').join(' ')}`} style={[styles.code, { color: colors.foreground, backgroundColor: colors.muted, borderRadius: radius.button }]}>
          {r.code}
        </Text>
        <Text style={{ color: colors.mutedForeground }}>{t('inviteLinkLabel')}</Text>
        <Text selectable style={{ color: colors.brand }}>
          {r.inviteLink}
        </Text>
      </Card>
      <Card>
        <Text testID="invite-progress" style={[styles.cardTitle, { color: colors.foreground }]}>
          {unlimited ? t('quotaProgressUnlimited', { used: quota.used }) : t('quotaProgress', { used: quota.used, limit: quota.limit! })}
        </Text>
        {!unlimited ? (
          <View accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: quota.limit!, now: quota.used }} style={[styles.track, { backgroundColor: colors.muted, borderRadius: radius.pill }]}>
            <View style={[styles.fill, { width: `${Math.min((quota.used / Math.max(quota.limit!, 1)) * 100, 100)}%`, backgroundColor: colors.brand, borderRadius: radius.pill }]} />
          </View>
        ) : null}
        <Text style={{ color: colors.mutedForeground, lineHeight: 21 }}>{next}</Text>
      </Card>
      <SectionTitle>{t('referralsTitle')}</SectionTitle>
      {r.referrals.length === 0 ? (
        <EmptyState title={t('referralsEmpty')} />
      ) : (
        <Card>
          {r.referrals.map((x) => (
            <View key={x.id} style={styles.row} accessible accessibilityLabel={[x.inviteeName ?? '—', x.inviteeCompleteness !== null ? `${t('colCompleteness')} ${x.inviteeCompleteness}%` : null, status[x.status]].filter(Boolean).join('，')}>
              <Text style={[styles.flex, { color: colors.foreground }]}>{x.inviteeName ?? '—'}</Text>
              {x.inviteeCompleteness !== null ? <Text style={{ color: colors.mutedForeground }}>{x.inviteeCompleteness}%</Text> : null}
              <Chip label={status[x.status]} />
            </View>
          ))}
        </Card>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  code: { fontSize: 28, fontWeight: '700', letterSpacing: 4, textAlign: 'center', paddingVertical: 12 },
  cardTitle: { fontSize: 17, fontWeight: '600' },
  track: { height: 8, overflow: 'hidden' },
  fill: { height: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
  flex: { flex: 1, fontSize: 16 },
})
