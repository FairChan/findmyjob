export type ApplicationBlocker = 'contactAndResume' | 'contact' | 'resume' | 'profile'

export function getApplicationBlocker(
  profile: { hasContact: boolean; hasResume: boolean; completeness: number },
  minCompleteness: number,
): ApplicationBlocker | null {
  if (!profile.hasContact && !profile.hasResume) return 'contactAndResume'
  if (!profile.hasContact) return 'contact'
  if (!profile.hasResume) return 'resume'
  if (profile.completeness < minCompleteness) return 'profile'
  return null
}
