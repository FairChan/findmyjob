# Registration Verification Email Implementation Plan

> **For agentic workers:** Execute this approved plan inline, one verified step at a time.

**Goal:** Route only account registration verification mail through an isolated Resend provider using the verified `findmyjob.asia` domain.

**Architecture:** Preserve the global SMTP/Resend provider for password resets, school codes, and notifications. Add optional email-provider overrides and dedicated configuration to the existing mailer; use those overrides only in Better Auth’s registration email-verification callback. Resend Contacts/audiences are not involved.

**Tech Stack:** Next.js 16, Better Auth, Resend Node SDK, Zod, Vitest.

## Global Constraints

- Use `FindMYJob <no-reply@findmyjob.asia>` as the verification sender.
- Keep the verification API key in a private deployment environment variable.
- Do not reuse the previously disclosed Resend API key.
- Keep other mail flows on their existing provider.

### Task 1: Test registration email routing and configuration

**Files:** `tests/unit/verification-resend-provider.test.ts`, `tests/unit/env.test.ts`, `tests/integration/auth-real-config.test.ts`.

- [x] Cover Resend API-key and sender overrides, unchanged SMTP for other mail, missing-setting validation, and Better Auth provider selection.
- [x] Verify red tests fail when the dedicated configuration is missing.

### Task 2: Add dedicated Resend support

**Files:** `src/lib/email.ts`, `src/server/auth.ts`, `src/env.ts`, `env.example`.

- [x] Allow optional Resend provider, API-key, and sender overrides without changing existing callers.
- [x] Route only `emailVerification.sendVerificationEmail` through the dedicated provider; keep password resets on the default mailer.
- [x] Require a dedicated Resend key and sender when Resend verification is enabled.
- [x] Document the three verification-only environment variables without adding real credentials.
- [x] Verify six focused unit-test files (37 tests), the focused auth routing test, TypeScript, and `git diff --check`.
- [ ] Complete live delivery after the owner enters a rotated Resend API key in the private deployment environment.
