import { mobileDeviceSchema, PUSHABLE_NOTIFICATION_TYPES } from '@shared/mobile-api'
import * as Notifications from 'expo-notifications'
import { AndroidImportance, AndroidNotificationVisibility } from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

import { apiFetch } from '@/lib/api-client'
import { appVersion } from '@/lib/api-config'

/**
 * App 端推送（MA3-T03）。服务端直接调 FCM HTTP v1，所以这里拿的是原生 FCM token（不是 Expo push token）。
 * 权限只在学生第一次投递成功后才请求（MOBILE.md §4.3）；之前已经授权（Android 12 及以下默认有）就直接注册。
 * 没有 Google 服务的手机拿不到 token：记下来，设置页提示"重要消息会发到邮箱"。
 */

const DEVICE_ID_KEY = 'findmyjob_push_device_id'
export const PUSH_CHANNEL_ID = 'default'

// 点开推送后允许跳转的 App 内路由；推送 data 里的 route 不在这里的一律回首页（防止被塞任意路由）
const ALLOWED_ROUTES = new Set<string>([...Object.values(PUSHABLE_NOTIFICATION_TYPES).map((v) => v.route), '/notifications'])

export function safePushRoute(route: unknown): string {
  return typeof route === 'string' && ALLOWED_ROUTES.has(route) ? route : '/'
}

export type PushSupport = 'granted' | 'undetermined' | 'denied' | 'unsupported'

let unsupported = false

export async function ensureChannel(name: string): Promise<void> {
  if (Platform.OS !== 'android') return
  await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
    name,
    importance: AndroidImportance.HIGH,
    // 锁屏只显示"有新消息"，内容本身也只是通用句子（TM-038）
    lockscreenVisibility: AndroidNotificationVisibility.PRIVATE,
  })
}

export async function pushSupport(): Promise<PushSupport> {
  if (unsupported) return 'unsupported'
  const { status } = await Notifications.getPermissionsAsync()
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined'
}

/** 已授权时注册（或刷新）本机 token；失败（无 GMS、网络）不抛错 */
export async function registerDeviceIfPermitted(locale: 'zh' | 'en'): Promise<string | null> {
  try {
    if ((await pushSupport()) !== 'granted') return null
    let token: string
    try {
      token = (await Notifications.getDevicePushTokenAsync()).data as string
    } catch {
      unsupported = true
      return null
    }
    const device = await apiFetch('/devices', {
      method: 'POST',
      body: { token, appVersion: appVersion(), locale },
      schema: mobileDeviceSchema,
    })
    await SecureStore.setItemAsync(DEVICE_ID_KEY, device.id)
    return device.id
  } catch {
    return null
  }
}

/** 第一次投递成功后调用：系统弹窗之前，调用方已经用自己的说明 Sheet 讲清楚了用途 */
export async function requestPermissionAndRegister(locale: 'zh' | 'en'): Promise<PushSupport> {
  const { status } = await Notifications.requestPermissionsAsync()
  if (status !== 'granted') return status === 'denied' ? 'denied' : 'undetermined'
  await registerDeviceIfPermitted(locale)
  return unsupported ? 'unsupported' : 'granted'
}

/** 退出登录前注销本机 token（服务端会话删除时也会级联删除，这里是尽早停推） */
export async function revokeThisDevice(): Promise<void> {
  const id = await SecureStore.getItemAsync(DEVICE_ID_KEY).catch(() => null)
  if (id) {
    await apiFetch(`/devices/${id}`, { method: 'DELETE' }).catch(() => {})
  }
  await SecureStore.deleteItemAsync(DEVICE_ID_KEY).catch(() => {})
}

const PROMPTED_KEY = 'findmyjob_push_prompted'

/** 只问一次：学生点过"以后再说"就不再自动弹（设置页里可以手动打开） */
export async function shouldOfferPushPrompt(): Promise<boolean> {
  if ((await pushSupport()) !== 'undetermined') return false
  return (await SecureStore.getItemAsync(PROMPTED_KEY).catch(() => null)) !== '1'
}

export async function markPushPrompted(): Promise<void> {
  await SecureStore.setItemAsync(PROMPTED_KEY, '1').catch(() => {})
}
