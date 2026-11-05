import type { ReactNode } from 'react'

// HTML structure is provided by src/app/[locale]/layout.tsx
export default function RootLayout({ children }: { children: ReactNode }) {
  return <>{children}</>
}
