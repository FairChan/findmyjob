'use client'

import Image from 'next/image'
import { motion, MotionConfig } from 'motion/react'

import Floating, { FloatingElement } from '@/components/ui/parallax-floating'

// Photos of places around Malaysia (sources in public/images/malaysia/SOURCES.md).
// Shown from xl, where the margins beside the headline are wide enough; the inner ring sits
// below the headline rows so it never touches the text.
const PHOTOS = [
  { n: '01', depth: 0.5, box: 'left-[2.5%] top-[6%] w-[10vw] max-w-40 aspect-[3/4]' },
  { n: '02', depth: 1.5, box: 'left-[15.5%] top-[52%] w-[7.5vw] max-w-32 aspect-square' },
  { n: '03', depth: 2, box: 'left-[1.5%] top-[42%] w-[12vw] max-w-48 aspect-[4/5]' },
  { n: '04', depth: 1, box: 'left-[13.5%] top-[74%] w-[8vw] max-w-36 aspect-[3/4]' },
  { n: '05', depth: 3, box: 'left-[4%] top-[84%] w-[8vw] max-w-32 aspect-[4/3]' },
  { n: '06', depth: 1, box: 'right-[2.5%] top-[4%] w-[10vw] max-w-40 aspect-[4/5]' },
  { n: '07', depth: 2, box: 'right-[15.5%] top-[50%] w-[7.5vw] max-w-32 aspect-[3/4]' },
  { n: '08', depth: 0.5, box: 'right-[1.5%] top-[40%] w-[12vw] max-w-48 aspect-[3/4]' },
  { n: '09', depth: 1.5, box: 'right-[13.5%] top-[76%] w-[8vw] max-w-36 aspect-square' },
] as const

/** Decorative photo collage behind the home headline; it drifts gently away from the pointer. */
export function HeroFloating() {
  return (
    <MotionConfig reducedMotion="user">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden xl:block">
        <Floating sensitivity={-0.6} easingFactor={0.06}>
          {PHOTOS.map((photo, index) => (
            <FloatingElement key={photo.n} depth={photo.depth} className={photo.box}>
              <motion.div
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.6, delay: 0.15 + index * 0.08, ease: 'easeOut' }}
                className="relative h-full w-full overflow-hidden rounded-card shadow-float"
              >
                <Image
                  src={`/images/malaysia/${photo.n}.jpg`}
                  alt=""
                  fill
                  sizes="(min-width: 1280px) 12vw, 1px"
                  className="object-cover"
                />
              </motion.div>
            </FloatingElement>
          ))}
        </Floating>
      </div>
    </MotionConfig>
  )
}
