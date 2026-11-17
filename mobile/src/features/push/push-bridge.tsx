import * as Notifications from 'expo-notifications'
import { useRouter } from 'expo-router'
import { useEffect, useRef } from 'react'
import { useLocale, useTranslations } from 'use-intl'

import { useMe } from '@/features/auth/use-me'
import { ensureChannel, registerDeviceIfPermitted, safePushRoute } from './push'

// 前台收到推送时也弹横幅（内容本身是通用句子）
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: true }),
})

/**
 * 登录后的学生：建通知渠道、已授权则注册 token；
 * 点开推送（前台、后台、冷启动三种情况）都按白名单路由跳转。
 */
export function PushBridge() {
  const router = useRouter()
  const locale = useLocale() as 'zh' | 'en'
  const t = useTranslations('mobile.tabs')
  const { me } = useMe()
  const registeredFor = useRef<string | null>(null)

  useEffect(() => {
    void ensureChannel(t('notifications')).catch(() => {})
  }, [t])

  useEffect(() => {
    if (me?.role !== 'STUDENT' || registeredFor.current === me.id) return
    registeredFor.current = me.id
    void registerDeviceIfPermitted(locale)
  }, [me, locale])

  useEffect(() => {
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response) return
      router.push(safePushRoute(response.notification.request.content.data?.route) as never)
    }
    // 冷启动：App 是被点推送拉起来的
    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => {})
    const sub = Notifications.addNotificationResponseReceivedListener(open)
    return () => sub.remove()
  }, [router])

  return null
}
