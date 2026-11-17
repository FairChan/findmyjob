import { useLocalSearchParams, useRouter } from 'expo-router'
import { Lock } from 'lucide-react-native'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { Button, Card, OfflineBanner, Screen, Sheet, TopBar, useToast } from '@/components/ui'
import { useTalentSearchResults, useTalentViewCache, useUnlock, useViewTalent, useWallet } from '@/features/employer/api'
import { TalentDetailSections, TalentSummary } from '@/features/employer/components'
import { useEmployerError } from '@/features/employer/errors'
import { useOnline } from '@/lib/online'
import { useSecureScreen } from '@/lib/secure-screen'
import { useTheme } from '@/theme/use-theme'

/**
 * E06 人才详情。GET /e/talent/:id 会写 ProfileView、计每日查看上限，所以进页面不自动加载：
 * 先显示搜索结果里已有的卡片摘要，用户点"查看完整档案"才请求（和学生端的预览 → 查看详情同一个模式）。
 * 解锁扣点数：确认抽屉里显示当前余额和本次花费，失败不自动重试；App 内没有任何购买入口。
 * 页面在屏幕上时开 FLAG_SECURE（MA4-T03）。
 */
export default function CandidateScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  useSecureScreen(`candidate-${id}`)
  const router = useRouter()
  const toast = useToast()
  const online = useOnline()
  const t = useTranslations('mobile.employer')
  const td = useTranslations('talentDetail')
  const common = useTranslations('mobile.common')
  const employerError = useEmployerError()
  const { colors } = useTheme()
  const cached = useTalentViewCache(id)
  const view = useViewTalent(id)
  const unlock = useUnlock(id)
  const wallet = useWallet()
  const search = useTalentSearchResults()
  const [confirming, setConfirming] = useState(false)

  const data = cached.data ?? view.data
  const card = search.data?.pages.flatMap((p) => p.items).find((c) => c.id === id)

  if (!data) {
    return (
      <Screen
        footer={
          <>
            {view.isError ? (
              <Text testID="e-candidate-error" accessibilityRole="alert" style={{ color: colors.destructive, lineHeight: 21 }}>
                {employerError(view.error, 'view')}
              </Text>
            ) : null}
            {!online ? <Text style={{ color: colors.mutedForeground }}>{common('offlineAction')}</Text> : null}
            <Button testID="e-candidate-view" label={t('viewProfileCounts')} onPress={() => view.mutate()} loading={view.isPending} disabled={!online} fullWidth />
          </>
        }
      >
        <TopBar title={t('candidateTitle')} />
        <OfflineBanner />
        {card ? (
          <Card>
            <TalentSummary card={card} />
          </Card>
        ) : null}
        <Text style={{ color: colors.mutedForeground, lineHeight: 21 }}>{t('viewProfileHint')}</Text>
      </Screen>
    )
  }

  const d = data.detail
  const cost = data.unlock.costCredits
  const balance = wallet.data?.balance ?? null
  const short = balance !== null && balance < cost

  return (
    <Screen
      footer={
        <>
          {!d.unlocked && data.unlock.enabled ? (
            <Button testID="e-candidate-unlock" label={td('unlockButton', { cost })} onPress={() => setConfirming(true)} disabled={!online || unlock.isPending} loading={unlock.isPending} fullWidth />
          ) : null}
          <Button testID="e-candidate-invite" label={t('invite')} variant="secondary" onPress={() => router.push(`/e/invite/${id}`)} fullWidth />
        </>
      }
    >
      <TopBar title={t('candidateTitle')} />
      <OfflineBanner />
      <View testID="e-candidate-detail">
        <Card>
          <TalentSummary card={d} />
        </Card>
      </View>
      {!d.unlocked ? (
        <Card style={{ backgroundColor: colors.muted, borderColor: colors.muted }}>
          <View style={styles.row}>
            <Lock color={colors.foreground} size={18} />
            <Text style={[styles.flex, { color: colors.foreground, lineHeight: 21 }]}>{td('unlockHint')}</Text>
          </View>
        </Card>
      ) : null}
      <TalentDetailSections detail={d} />
      <Text style={{ color: colors.mutedForeground, lineHeight: 21 }}>
        {d.unlocked ? t('resumeCountUnlocked', { count: d.resumeIds.length }) : t('resumeCountLocked', { count: d.resumeCount })}
      </Text>
      {unlock.isError ? (
        <Text testID="e-unlock-error" accessibilityRole="alert" style={{ color: colors.destructive, lineHeight: 21 }}>
          {employerError(unlock.error, 'unlock')}
        </Text>
      ) : null}

      <Sheet open={confirming} onClose={() => setConfirming(false)} title={td('unlockConfirmTitle')} closeLabel={common('close')}>
        <Text style={[styles.body, { color: colors.foreground }]}>{td('unlockConfirmDesc')}</Text>
        <Text testID="e-unlock-cost" style={[styles.body, { color: colors.foreground, fontWeight: '600' }]}>
          {td('unlockConfirmCost', { cost })}
        </Text>
        <Text testID="e-unlock-balance" style={{ color: short ? colors.destructive : colors.mutedForeground }}>
          {balance === null ? t('balanceUnknown') : t('balanceNow', { count: balance })}
        </Text>
        {short ? <Text style={{ color: colors.destructive }}>{t('errors.insufficientCredits')}</Text> : null}
        <Button
          testID="e-unlock-confirm"
          label={td('unlockConfirmOk')}
          fullWidth
          disabled={short}
          onPress={() => {
            setConfirming(false)
            unlock.mutate(undefined, {
              onSuccess: ({ res, view: reloaded }) => toast(res.alreadyUnlocked ? t('alreadyUnlocked') : reloaded ? t('unlockedNow') : t('unlockedReload')),
            })
          }}
        />
        <Button label={td('unlockConfirmCancel')} variant="secondary" fullWidth onPress={() => setConfirming(false)} />
      </Sheet>
    </Screen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  body: { fontSize: 16, lineHeight: 24 },
})
