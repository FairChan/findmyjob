import 'server-only'
import {
  toTalentCard,
  type ProfileCardInput,
  type TalentCard,
} from '@/server/serializers/talent-card'

/**
 * Builds the payload for employer-facing notifications about a student.
 * The payload is always generated with unlocked=false so free-text fields are
 * PII-safe. The caller is responsible for determining canSeeName:
 *   - true  when a TalentUnlock record exists, the student has not blocked the
 *           company, and the account is not deleted (implemented in M4-T08).
 *   - false otherwise.
 * Note: Notification.payload is a snapshot at send time; a later block or
 * account deletion does not retroactively redact names already stored
 * (accepted risk — purge-deleted-accounts in M7-T03 cleans up deleted users).
 */
export function buildEmployerStudentPayload(
  profile: ProfileCardInput,
  opts: { canSeeName: boolean },
): TalentCard {
  const card = toTalentCard(profile, { unlocked: false })
  if (opts.canSeeName) {
    return { ...card, name: profile.fullName }
  }
  return card
}
