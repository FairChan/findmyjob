'use client'

import { useRef, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { motion, useReducedMotion } from 'motion/react'
import { X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useJobBrowserMotion } from './job-browser-motion'

export function JobRouteModal({ jobId, children }: { jobId: string; children: ReactNode }) {
  const t = useTranslations('jobBrowser')
  const router = useRouter()
  const browser = useJobBrowserMotion()
  const reducedMotion = useReducedMotion()
  const closing = useRef(false)

  function close() {
    if (closing.current) return
    closing.current = true
    router.back()
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) close() }}>
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <motion.div
            className="fixed inset-0 z-50 bg-foreground/35 backdrop-blur-sm"
            initial={{ opacity: reducedMotion ? 1 : 0 }}
            animate={{ opacity: 1 }}
          />
        </Dialog.Overlay>
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
          <Dialog.Content
            asChild
            aria-describedby={undefined}
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              browser?.restoreOpener()
            }}
          >
            <motion.div
              layoutId={reducedMotion ? undefined : `job-card-${jobId}`}
              layoutScroll
              layoutRoot
              className="pointer-events-auto relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-card border bg-background shadow-float outline-none sm:max-h-[calc(100dvh-3rem)]"
            >
              <div className="flex shrink-0 items-center justify-between gap-4 border-b px-5 py-2 sm:px-8">
                <Dialog.Title className="text-sm font-medium text-muted-foreground">{t('details')}</Dialog.Title>
                <Dialog.Close
                  aria-label={t('close')}
                  className="-mr-2 inline-flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X aria-hidden="true" className="size-5" />
                </Dialog.Close>
              </div>
              <div className="min-h-0 overflow-y-auto overscroll-contain break-words px-5 pb-8 pt-5 sm:px-8 sm:pt-6" data-job-modal-scroll>
                {children}
              </div>
            </motion.div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
