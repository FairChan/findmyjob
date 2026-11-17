// App 级事件：API 层发现"会话失效 / 要重新同意条款 / 版本过低"时广播，根布局负责切换到对应页面。
export type AppEvent = 'signed-out' | 'needs-reconsent' | 'update-required'

type Listener = (event: AppEvent) => void
const listeners = new Set<Listener>()

export function onAppEvent(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function emitAppEvent(event: AppEvent): void {
  for (const l of [...listeners]) l(event)
}
