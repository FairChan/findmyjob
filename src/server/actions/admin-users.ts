'use server'
import { z } from 'zod'
import { headers } from 'next/headers'
import { action } from '@/server/action'
import { getClientIp } from '@/server/lib/client-ip'
import {
  suspendUser,
  suspendUserSchema,
  restoreUser,
  restoreUserSchema,
  grantJobViewQuota,
  grantJobViewQuotaSchema,
  approveSchoolVerificationManually,
  readStudentContactAdmin,
} from '@/server/services/admin-users'

export const suspendUserAction = action(
  { auth: 'admin', input: suspendUserSchema },
  async (ctx) => {
    return suspendUser({ userId: ctx.userId! }, ctx.input)
  },
)

export const restoreUserAction = action(
  { auth: 'admin', input: restoreUserSchema },
  async (ctx) => {
    return restoreUser({ userId: ctx.userId! }, ctx.input)
  },
)

export const grantJobViewQuotaAction = action(
  { auth: 'admin', input: grantJobViewQuotaSchema },
  async (ctx) => {
    return grantJobViewQuota({ userId: ctx.userId! }, ctx.input)
  },
)

export const approveSchoolVerificationAction = action(
  { auth: 'admin', input: z.object({ studentUserId: z.string().min(1) }) },
  async (ctx) => {
    return approveSchoolVerificationManually({ userId: ctx.userId! }, ctx.input.studentUserId)
  },
)

export const readStudentContactAdminAction = action(
  { auth: 'admin-fresh', input: z.object({ studentUserId: z.string().min(1) }) },
  async (ctx) => {
    const h = await headers()
    const ip = getClientIp(h)
    return readStudentContactAdmin({ userId: ctx.userId! }, ctx.input.studentUserId, ip ?? undefined)
  },
)
