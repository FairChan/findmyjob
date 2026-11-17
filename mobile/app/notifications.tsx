import { useRouter } from 'expo-router'
import { useMemo } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useFormatter, useTranslations } from 'use-intl'

import { Button, EmptyState, ErrorState, ListSkeleton, OfflineBanner, Screen, TopBar } from '@/components/ui'
import { notificationKey, notificationTarget, useMarkRead, useNotifications } from '@/features/notifications/api'
import { useErrorMessage } from '@/i18n/error-message'
import { useTheme } from '@/theme/use-theme'

/** S16 通知中心：按类型显示本地化文案（通知不带 payload）；点一条标已读并跳到对应页面 */
export default function Notifications() {
  const router = useRouter()
  const t = useTranslations('notifications')
  const m = useTranslations('mobile.notificationsScreen')
  const format = useFormatter()
  const errorMessage = useErrorMessage()
  const { colors, radius, minTouchTarget } = useTheme()
  const query = useNotifications()
  const markRead = useMarkRead()
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.items) ?? [], [query.data])
  const unread = query.data?.pages[0]?.unreadCount ?? 0

  return (
    <Screen scroll={false}>
      <View style={styles.header}>
        <TopBar
          title={t('title')}
          right={
            unread > 0 ? (
              <Button testID="notifications-read-all" label={m('markAllRead')} variant="ghost" loading={markRead.isPending} onPress={() => markRead.mutate({ all: true })} />
            ) : undefined
          }
        />
        <OfflineBanner />
      </View>
      {query.isPending ? (
        <ListSkeleton />
      ) : query.isError && !items.length ? (
        <ErrorState message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <FlatList
          testID="notifications-list"
          data={items}
          keyExtractor={(n) => n.id}
          contentContainerStyle={styles.content}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage()
          }}
          refreshControl={<RefreshControl refreshing={query.isRefetching && !query.isFetchingNextPage} onRefresh={() => void query.refetch()} tintColor={colors.brand} colors={[colors.brand]} />}
          ListEmptyComponent={<EmptyState title={m('empty')} />}
          ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={colors.brand} style={styles.footer} /> : undefined}
          renderItem={({ item }) => {
            const label = t(notificationKey(item.type) as 'unknownType')
            const isUnread = item.readAt === null
            const when = format.dateTime(new Date(item.createdAt), { dateStyle: 'medium', timeStyle: 'short' })
            const target = notificationTarget(item.type)
            return (
              <Pressable
                testID={`notification-${item.id}`}
                accessibilityRole={target ? 'button' : 'text'}
                accessibilityLabel={[isUnread ? t('unread') : null, label, when].filter(Boolean).join('，')}
                onPress={() => {
                  if (isUnread) markRead.mutate({ ids: [item.id] })
                  if (target) router.push(target)
                }}
                style={[styles.item, { minHeight: minTouchTarget + 16, borderBottomColor: colors.border }]}
              >
                <View style={[styles.dot, { backgroundColor: isUnread ? colors.brand : 'transparent', borderRadius: radius.pill }]} />
                <View style={styles.flex}>
                  <Text style={[styles.label, { color: colors.foreground, fontWeight: isUnread ? '600' : '400' }]}>{label}</Text>
                  <Text style={{ color: colors.mutedForeground }}>{when}</Text>
                </View>
              </Pressable>
            )
          }}
        />
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { gap: 12, paddingTop: 8, paddingBottom: 4 },
  content: { paddingBottom: 24 },
  footer: { paddingVertical: 16 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  dot: { width: 10, height: 10 },
  flex: { flex: 1, gap: 2 },
  label: { fontSize: 16 },
})
