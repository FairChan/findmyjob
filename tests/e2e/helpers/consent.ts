/**
 * Write current-version consent records (TERMS + PRIVACY) for a user.
 *
 * Used by loginAs (default) and global-setup to ensure fixture users are not
 * redirected to the reconsent page during E2E tests.
 *
 * The version is read from SystemSetting 'legal.currentVersion'; if the row
 * doesn't exist the same default as legal-consent.ts is used.
 */
import { e2eDb } from './db'

const DEFAULT_LEGAL_VERSION = '2026-11-draft'

export async function writeCurrentVersionConsent(userId: string): Promise<void> {
  const setting = await e2eDb.systemSetting.findUnique({
    where: { key: 'legal.currentVersion' },
  })
  const version = (setting?.value as string) ?? DEFAULT_LEGAL_VERSION

  await e2eDb.$transaction([
    e2eDb.consent.create({
      data: { userId, type: 'TERMS', version, granted: true },
    }),
    e2eDb.consent.create({
      data: { userId, type: 'PRIVACY', version, granted: true },
    }),
  ])
}
