import 'server-only'
import { PrismaClient } from '@prisma/client'
import { env } from '@/env'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.APP_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

if (env.APP_ENV !== 'production') globalForPrisma.prisma = db
