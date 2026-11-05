'use server'
import { z } from 'zod'
import { action } from '@/server/action'
import { getSetting } from '@/server/services/settings'
import { recordLegalConsent } from '@/server/services/legal-consent'
import { getClientIp } from '@/server/lib/client-ip'
import { headers } from 'next/headers'

const schema = z.object({ agreed: z.literal(true) })

export const submitReconsentAction = action(
  { auth: 'user', input: schema },
  async ({ userId }) => {
    const headerStore = await headers()
    const ip = getClientIp(headerStore)
    const ua = headerStore.get('user-agent') ?? undefined
    const version = await getSetting('legal.currentVersion', '2026-11-draft')

    await recordLegalConsent(userId!, { version, ip: ip ?? undefined, userAgent: ua })
  },
)
