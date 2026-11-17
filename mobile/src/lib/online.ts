import { onlineManager } from '@tanstack/react-query'
import { addNetworkStateListener } from 'expo-network'
import { useSyncExternalStore } from 'react'

/**
 * 把系统网络状态接到 TanStack Query 的 onlineManager：离线时查询暂停、缓存照常显示，
 * 恢复联网后再自动续上。只在根布局调用一次。
 */
export function bindOnlineManager(): void {
  onlineManager.setEventListener((setOnline) => {
    const sub = addNetworkStateListener((state) => setOnline(state.isConnected !== false))
    return () => sub.remove()
  })
}

/** 当前是否在线；写操作（投递、上传、注销）离线时禁用，不做离线排队（MOBILE.md §5.1） */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  )
}
