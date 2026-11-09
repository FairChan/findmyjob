import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { headers } from 'next/headers'
import { NonceProvider } from '@/components/auth/NonceProvider'

export const metadata: Metadata = {
  manifest: '/manifest.webmanifest',
  icons: {
    apple: '/icons/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#2463eb',
}

// HTML structure is provided by src/app/[locale]/layout.tsx
export default async function RootLayout({ children }: { children: ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined
  return <NonceProvider nonce={nonce}>{children}</NonceProvider>
}
