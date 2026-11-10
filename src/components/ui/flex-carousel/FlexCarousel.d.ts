import type { CSSProperties, ReactNode } from 'react'

export interface FlexCarouselItem {
  src: string
  alt?: string
  title?: string
  subtitle?: string
}

export interface FlexCarouselProps {
  items: FlexCarouselItem[]
  /** Accessible name of the carousel region. */
  ariaLabel?: string
  preset?: 'liquid' | 'ribbon' | 'vortex' | 'arch'
  intro?: 'rise' | 'bloom' | 'spin' | 'deal' | 'none'
  fit?: 'natural' | 'portrait' | 'square' | 'landscape'
  cardHeight?: number
  gap?: number
  radius?: number
  lensWidth?: number
  lensHeight?: number
  tilt?: number
  roundness?: number
  bend?: number
  reach?: number
  curl?: 'twist' | 'rise' | 'fall'
  dispersion?: number
  liquid?: number
  followCursor?: boolean
  squeeze?: number
  focusOnClick?: boolean
  autoplay?: boolean
  interval?: number
  captions?: boolean
  captureWheel?: boolean
  onChange?: (index: number, item: FlexCarouselItem) => void
  /** Called when the centred card is clicked or Enter is pressed. */
  onSelect?: (index: number, item: FlexCarouselItem) => void
  className?: string
  style?: CSSProperties
}

export default function FlexCarousel(props: FlexCarouselProps): ReactNode
