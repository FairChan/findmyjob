import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: 'FindMYJob',
  description: '帮在马来西亚的中国留学生找实习和工作的平台',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  return (
    <html lang="zh-Hans">
      <body>{children}</body>
    </html>
  )
}
