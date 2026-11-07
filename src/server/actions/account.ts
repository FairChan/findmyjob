'use server'
import { z } from 'zod'
import { headers } from 'next/headers'
import { action } from '@/server/action'
import { getSession } from '@/server/auth'
import { db } from '@/server/db'
import { isSafePath } from '@/server/lib/is-safe-path'

export { isSafePath }

export const getPostLoginRedirect = action(
  {
    auth: 'public',
    input: z.object({
      locale: z.string(),
      redirect: z.string().optional(),
    }),
  },
  async ({ input }) => {
    const h = await headers()
    const session = await getSession(h)
    if (!session?.user?.id) {
      return { path: `/${input.locale}/login` }
    }

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { role: true, status: true },
    })

    if (!user || user.status !== 'ACTIVE') {
      return { path: `/${input.locale}/login` }
    }

    const { locale, redirect } = input

    if (redirect && isSafePath(redirect, user.role, locale)) {
      return { path: redirect }
    }

    if (user.role === 'STUDENT') {
      const profile = await db.studentProfile.findUnique({
        where: { userId: session.user.id },
        select: { completeness: true },
      })
      const path =
        !profile || profile.completeness === 0
          ? `/${locale}/s/onboarding`
          : `/${locale}/s`
      return { path }
    }

    if (user.role === 'EMPLOYER') {
      const member = await db.companyMember.findFirst({
        where: { userId: session.user.id },
        select: { id: true },
      })
      const path = !member ? `/${locale}/e/onboarding` : `/${locale}/e`
      return { path }
    }

    // ADMIN
    return { path: `/${locale}/admin` }
  },
)

export const updateLocaleAction = action(
  {
    auth: 'user',
    input: z.object({ locale: z.enum(['zh', 'en']) }),
  },
  async ({ userId, input }) => {
    await db.user.update({
      where: { id: userId },
      data: { locale: input.locale },
    })
    return {}
  },
)
