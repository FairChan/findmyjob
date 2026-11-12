import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Without this, tailwind-merge reads the custom type-scale utilities (text-title, …) as
// text colours and drops them whenever a real colour class follows in the same call.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['display', 'headline', 'title', 'lead', 'body'] }],
      rounded: [{ rounded: ['control', 'card', 'tile'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
