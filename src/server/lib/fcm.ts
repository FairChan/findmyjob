import 'server-only'
import { getGoogleAccessToken } from './google-oauth'

// FCM HTTP v1 发送（MA3-T02）。只在 worker 里、事务之外调用。
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
const FETCH_TIMEOUT_MS = 10_000

export function fcmProjectId(): string | null {
  return process.env.FCM_PROJECT_ID?.trim() || null
}

export function isFcmConfigured(): boolean {
  return !!fcmProjectId() && !!process.env.GOOGLE_SERVICE_ACCOUNT_FILE?.trim()
}

export type FcmMessage = {
  token: string
  title: string
  body: string
  data: Record<string, string>
}

/** permanent：token 已失效（要吊销）；transient：下次再试；ok：已交给 FCM */
export type FcmResult = { outcome: 'ok' } | { outcome: 'permanent' | 'transient'; code: string }

export async function sendFcm(msg: FcmMessage): Promise<FcmResult> {
  const project = fcmProjectId()
  if (!project) return { outcome: 'transient', code: 'NOT_CONFIGURED' }
  let res: Response
  try {
    res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(project)}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await getGoogleAccessToken(SCOPE)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: msg.token,
          notification: { title: msg.title, body: msg.body },
          data: msg.data,
          android: {
            priority: 'HIGH',
            // 锁屏只显示通用标题和正文（本身不含 PII）；PRIVATE 让系统在锁屏上按用户设置隐藏内容
            notification: { channel_id: 'default', visibility: 'PRIVATE' },
          },
        },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch {
    return { outcome: 'transient', code: 'NETWORK' }
  }
  if (res.ok) return { outcome: 'ok' }
  let status = ''
  try {
    const body = (await res.json()) as { error?: { status?: string; details?: Array<{ errorCode?: string }> } }
    status = body.error?.details?.find((d) => d.errorCode)?.errorCode ?? body.error?.status ?? ''
  } catch {
    status = ''
  }
  // https://firebase.google.com/docs/reference/fcm/rest/v1/ErrorCode
  if (res.status === 404 || status === 'UNREGISTERED' || status === 'INVALID_ARGUMENT' || status === 'SENDER_ID_MISMATCH') {
    return { outcome: 'permanent', code: status || `HTTP_${res.status}` }
  }
  return { outcome: 'transient', code: status || `HTTP_${res.status}` }
}
