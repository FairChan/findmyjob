'use server'
import { z } from 'zod'
import { action } from '@/server/action'
import { recordLegalConsent } from '@/server/services/legal-consent'
import { getClientIp } from '@/server/lib/client-ip'
import { headers } from 'next/headers'

const schema = z.object({ agreed: z.literal(true), version: z.string() })

export const submitReconsentAction = action(
  { auth: 'user', input: schema },
  async ({ userId, input }) => {
    const headerStore = await headers()
    const ip = getClientIp(headerStore)
    const ua = headerStore.get('user-agent') ?? undefined

    await recordLegalConsent(userId!, {
      submittedVersion: input.version,
      ip: ip ?? undefined,
      userAgent: ua,
    })
  },
)
