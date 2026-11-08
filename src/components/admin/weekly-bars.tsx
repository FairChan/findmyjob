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
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <p className="font-semibold">{title}</p>
      <div className="relative mt-4 flex h-44 items-end gap-[2px] border-b border-gray-200">
        {data.map((d, i) => (
          <div
            key={d.label}
            className="relative flex h-full flex-1 items-end justify-center"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <div
              className={`w-full max-w-9 rounded-t-[4px] transition-colors ${
                hover === i ? 'bg-[var(--color-brand-600,#2563eb)]' : 'bg-[var(--color-brand-500,#3b82f6)]'
              }`}
              style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value > 0 ? '2px' : undefined }}
            />
            {hover === i && (
              <span className="absolute -top-1 z-10 -translate-y-full whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs text-white">
                {d.label}：{d.value}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-[2px] text-center text-[11px] text-gray-400">
        {data.map((d) => (
          <span key={d.label} className="flex-1 truncate">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  )
}
