import 'server-only'
import {
  toTalentCard,
  type ProfileCardInput,
  type TalentCard,
} from '@/server/serializers/talent-card'

/**
 * Builds the payload for employer-facing notifications about a student.
 * Full name is included only when the employer has unlocked the student
 * or the student has applied to one of the employer's jobs.
 * Never passes contact info — structured contact is obtained via contact-access only.
 */
export function buildEmployerStudentPayload(
  profile: ProfileCardInput,
  opts: { isUnlocked: boolean; hasApplied: boolean },
): TalentCard {
  return toTalentCard(profile, {
    unlocked: opts.isUnlocked || opts.hasApplied,
  })
}
