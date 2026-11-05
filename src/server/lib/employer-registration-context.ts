import { AsyncLocalStorage } from 'async_hooks'

// Used to skip the student signup cap check during employer registration,
// since Better Auth creates all users with role=STUDENT before the action
// updates the role to EMPLOYER.
export const employerRegistrationContext = new AsyncLocalStorage<true>()

export function isEmployerRegistration(): boolean {
  return employerRegistrationContext.getStore() === true
}
