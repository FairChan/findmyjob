import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

// Cards separate from the page by surface colour, not by border plus shadow:
// `muted` on a white section, `plain` on a muted section.
const cardVariants = cva('text-card-foreground', {
  variants: {
    surface: {
      muted: 'bg-muted',
      plain: 'bg-card',
      outline: 'border bg-card',
      inverse: 'bg-foreground text-background',
    },
    size: {
      card: 'rounded-card p-5 sm:p-6',
      tile: 'rounded-tile p-7 sm:p-9',
    },
  },
  defaultVariants: { surface: 'muted', size: 'card' },
})

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

function Card({ className, surface, size, ...props }: CardProps) {
  return <div className={cn(cardVariants({ surface, size }), className)} {...props} />
}

export { Card, cardVariants }
