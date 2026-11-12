'use client'

import { useState } from 'react'

interface WeeklyBarsProps {
  title: string
  data: Array<{ label: string; value: number }>
}

export function WeeklyBars({ title, data }: WeeklyBarsProps) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(...data.map((d) => d.value), 1)

  return (
    <div className="@container min-w-0 rounded-card border border-border bg-card p-5">
      <p className="font-semibold">{title}</p>
      <div className="relative mt-4 flex h-44 items-end gap-[2px] border-b border-border">
        {data.map((d, i) => (
          <div
            key={d.label}
            className="relative flex h-full flex-1 items-end justify-center"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <div
              className={`w-full max-w-9 rounded-t-[4px] transition-colors ${
                hover === i ? 'bg-brand' : 'bg-brand/75'
              }`}
              style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value > 0 ? '2px' : undefined }}
            />
            {hover === i && (
              <span className="absolute -top-1 z-10 -translate-y-full whitespace-nowrap rounded-control bg-foreground px-2 py-1 text-xs text-background">
                {d.label}：{d.value}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex h-7 gap-[2px] text-center text-[11px] text-muted-foreground @[400px]:mt-1.5 @[400px]:h-auto">
        {data.map((d) => (
          <span key={d.label} className="min-w-0 flex-1">
            <span className="inline-block -rotate-45 whitespace-nowrap @[400px]:rotate-0">
              {d.label}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}
