import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info } from 'lucide-react'
import { uid } from '../lib/utils'

type Tone = 'success' | 'error' | 'info'
const ToastCtx = createContext<(msg: string, tone?: Tone) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: string; msg: string; tone: Tone }[]>([])
  const push = useCallback((msg: string, tone: Tone = 'success') => {
    const id = uid()
    setItems((x) => [...x, { id, msg, tone }])
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 2800)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed left-1/2 top-20 z-[100] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className="flex animate-[fadein_.2s_ease-out] items-center gap-2 rounded-lg bg-gray-900/90 px-4 py-2.5 text-sm text-white shadow-lg">
            {i.tone === 'success' && <CircleCheck className="size-4 text-emerald-400" />}
            {i.tone === 'error' && <CircleAlert className="size-4 text-red-400" />}
            {i.tone === 'info' && <Info className="size-4 text-sky-300" />}
            {i.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)
