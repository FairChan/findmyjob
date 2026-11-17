import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useTranslations } from 'use-intl'

import { Button, EmptyState, ErrorState, ListSkeleton, OfflineBanner, Screen, Segmented, Sheet, useToast } from '@/components/ui'
import { CLOSED_STATUSES, useApplications, useInvitations, useRespondInvitation } from '@/features/applications/api'
import { ApplicationCard, InvitationCard, isInvitationOpen } from '@/features/applications/components'
import { useErrorMessage } from '@/i18n/error-message'
import { ApiError } from '@/lib/api-client'
import { useTheme } from '@/theme/use-theme'

type Tab = 'active' | 'closed' | 'invitations'

/** S12 我的投递（进行中 / 已结束）+ S14 收到的邀请 */
export default function ApplicationsTab() {
  const params = useLocalSearchParams<{ tab?: string }>()
  const router = useRouter()
  const toast = useToast()
  const t = useTranslations('mobile.applications')
  const my = useTranslations('myApplications')
  const inv = useTranslations('invitations')
  const common = useTranslations('mobile.common')
  const errorMessage = useErrorMessage()
  const { colors } = useTheme()
  const [tab, setTab] = useState<Tab>(params.tab === 'invitations' ? 'invitations' : 'active')
  // 从通知深链（?tab=invitations）进来时切到邀请分段；tab 页常驻，所以要跟着参数变
  const [lastParam, setLastParam] = useState(params.tab)
  if (params.tab !== lastParam) {
    setLastParam(params.tab)
    if (params.tab === 'invitations') setTab('invitations')
  }
  const [declining, setDeclining] = useState<string | null>(null)
  const applications = useApplications()
  const invitations = useInvitations()
  const respond = useRespondInvitation()

  const pendingInvites = invitations.data?.items.filter((i) => isInvitationOpen(i)).length ?? 0
  const lists = useMemo(() => {
    const items = applications.data?.items ?? []
    return { active: items.filter((a) => !CLOSED_STATUSES.has(a.status)), closed: items.filter((a) => CLOSED_STATUSES.has(a.status)) }
  }, [applications.data])

  // 接受邀请走 applyToJob 的全部校验：缺材料时给出具体原因；已过期/已处理（403）给邀请语境的文案
  function respondError(err: unknown): string {
    if (err instanceof ApiError && (err.code === 'FORBIDDEN' || err.code === 'NOT_FOUND')) return inv('acceptErrorUnavailable')
    return errorMessage(err)
  }

  async function accept(id: string) {
    try {
      const res = await respond.mutateAsync({ id, action: 'accept' })
      toast(inv('acceptSuccess'))
      if (res.applicationId) router.push(`/applications/${res.applicationId}`)
    } catch (err) {
      toast(respondError(err), 'error')
    }
  }

  async function decline(id: string) {
    setDeclining(null)
    try {
      await respond.mutateAsync({ id, action: 'decline' })
      toast(inv('declineSuccess'))
    } catch (err) {
      toast(respondError(err), 'error')
    }
  }

  const q = tab === 'invitations' ? invitations : applications
  const refresh = (
    <RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={colors.brand} colors={[colors.brand]} />
  )

  let body
  if (q.isPending) body = <ListSkeleton />
  else if (q.isError && !q.data) body = <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
  else if (tab === 'invitations') {
    body = (
      <FlatList
        testID="invitations-list"
        data={invitations.data?.items ?? []}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => (
          <InvitationCard inv={item} busy={respond.isPending && respond.variables?.id === item.id} onAccept={() => void accept(item.id)} onDecline={() => setDeclining(item.id)} />
        )}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={styles.content}
        refreshControl={refresh}
        ListEmptyComponent={<EmptyState title={inv('empty')} body={inv('emptyDesc')} />}
      />
    )
  } else {
    body = (
      <FlatList
        testID={`applications-${tab}`}
        data={lists[tab]}
        keyExtractor={(a) => a.id}
        renderItem={({ item }) => <ApplicationCard app={item} onPress={() => router.push(`/applications/${item.id}`)} />}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={styles.content}
        refreshControl={refresh}
        ListEmptyComponent={
          <EmptyState
            title={tab === 'active' ? t('empty') : t('emptyClosed')}
            body={tab === 'active' ? my('emptyHint') : undefined}
            action={tab === 'active' ? <Button label={my('browseJobs')} variant="secondary" onPress={() => router.push('/jobs')} /> : undefined}
          />
        }
      />
    )
  }

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
          {my('title')}
        </Text>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'active', label: t('active') },
            { value: 'closed', label: t('closed') },
            { value: 'invitations', label: t('invitations'), badge: pendingInvites },
          ]}
        />
        <OfflineBanner />
      </View>
      {body}
      <Sheet open={declining !== null} onClose={() => setDeclining(null)} title={inv('declineConfirmTitle')} closeLabel={common('close')}>
        <Text style={{ color: colors.foreground, lineHeight: 22 }}>{inv('declineConfirmBody')}</Text>
        <Button testID="decline-confirm" label={inv('declineButton')} variant="destructive" fullWidth onPress={() => declining && void decline(declining)} />
        <Button label={inv('declineConfirmCancel')} variant="secondary" fullWidth onPress={() => setDeclining(null)} />
      </Sheet>
    </Screen>
  )
}

function Separator() {
  return <View style={styles.sep} />
}

const styles = StyleSheet.create({
  header: { gap: 12, paddingTop: 16, paddingBottom: 12 },
  title: { fontSize: 28, fontWeight: '700' },
  content: { paddingBottom: 24 },
  sep: { height: 12 },
})
