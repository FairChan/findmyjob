'use client'

import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  url: string
  label: string
}

export function ExportDownloadButton({ url, label }: Props) {
  return (
    <a href={url} download className={cn(buttonVariants({ variant: 'brand' }), 'h-11')}>
      {label}
    </a>
  )
}
