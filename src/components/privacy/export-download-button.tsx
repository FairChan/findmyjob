'use client'

interface Props {
  url: string
  label: string
}

export function ExportDownloadButton({ url, label }: Props) {
  return (
    <a
      href={url}
      download
      className="inline-flex min-h-[44px] min-w-[44px] items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
    >
      {label}
    </a>
  )
}
