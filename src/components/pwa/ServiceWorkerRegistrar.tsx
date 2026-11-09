'use client'

import { useEffect } from 'react'

/**
 * Registers /sw.js in production only.
 * Development and E2E environments are excluded to avoid interfering with
 * hot reloads and no-store API responses.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Registration failure is non-fatal — SW is a progressive enhancement.
    })
  }, [])

  return null
}
