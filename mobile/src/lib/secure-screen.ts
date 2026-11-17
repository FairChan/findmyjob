import { useFocusEffect } from 'expo-router'
import * as ScreenCapture from 'expo-screen-capture'
import { useCallback } from 'react'

/**
 * 候选人详情这类页面开 FLAG_SECURE（禁止截屏、录屏，最近任务里显示空白，MOBILE.md §5.6 / MA4-T03）。
 * 用聚焦而不是挂载来开关：Stack 里压上一个新页面时旧页面仍然挂载，但已经不在屏幕上，不该继续拦截。
 * 每个页面用自己的 key，多个页面叠加时互不解除对方。
 */
export function useSecureScreen(key: string): void {
  useFocusEffect(
    useCallback(() => {
      void ScreenCapture.preventScreenCaptureAsync(key).catch(() => {})
      return () => {
        void ScreenCapture.allowScreenCaptureAsync(key).catch(() => {})
      }
    }, [key]),
  )
}
