import 'server-only'
import { FeatureDisabledError } from '../errors'
import { getSetting } from './settings'

export async function assertFeatureEnabled(key: string, label: string): Promise<void> {
  const enabled = await getSetting<unknown>(key, true)
  if (enabled !== true) {
    throw new FeatureDisabledError(`${label} is currently disabled`)
  }
}

export async function assertUnlockEnabled(): Promise<void> {
  return assertFeatureEnabled('unlock.enabled', 'Unlock')
}

export async function assertTalentSearchEnabled(): Promise<void> {
  return assertFeatureEnabled('talentPool.searchEnabled', 'Talent pool search')
}

export async function assertUploadsEnabled(): Promise<void> {
  return assertFeatureEnabled('uploads.enabled', 'File uploads')
}
