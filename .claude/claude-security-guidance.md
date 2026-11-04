# FindMYJob security guidance (project level)

## Context
FindMYJob is a job and internship platform for international (mainly Chinese) students in Malaysia. Stack: Next.js App Router (Server Actions + Route Handlers), Prisma 6, PostgreSQL 16, Better Auth, pg-boss worker, S3-compatible private storage, Caddy in front (TLS termination; it sets X-Real-IP). Production faces the public internet. Student personal data is covered by Malaysia's PDPA. Employers search an anonymized talent pool and spend credits to unlock a student's full name, contact details and original resume. Development sessions run through a third-party AI relay, so the repository must only ever contain synthetic data.

Approved project patterns (recognize them, do not flag them as missing): every Server Action is wrapped in `action()` and every Route Handler in `route()` (src/server/action.ts, src/server/route.ts); employer identity comes from `requireCompanyMember()`; client IP comes only from `getClientIp()`; advisory locks only via `lockXact(tx, LOCK_NS.X, id)`; field encryption only via `encryptField` / `decryptField` with AAD; logs only via src/server/lib/logger.ts (pino with redaction); alerts only via `alert()`.

## Five red lines
1. Privacy boundary. Employer-facing student data leaves the server only through src/server/serializers/talent-card.ts (`toTalentCard` / `toTalentDetail`). Contact details are read and decrypted only in src/server/services/contact-access.ts. Free text shown to employers (headline, summary, skill tags, education and experience text, resume preview) must pass through redact. Employer notifications and emails carry only serializer output. The anti-leak tests must never be deleted or weakened.
2. Credits and quotas. Wallet balance changes only through `applyLedgerEntry` in src/server/services/credits.ts, inside `prisma.$transaction`. CreditLedger and AuditLog are append-only (the app role has no UPDATE/DELETE/TRUNCATE on them). Student job-view quota is computed and consumed only in src/server/services/job-view-quota.ts. Any double-spend, negative balance or quota bypass is a defect.
3. Authorization. `companyId` must come from `requireCompanyMember()`, never from params, query, form data or body. `require*` helpers hit the database on every call (user status, membership, company active and verified). Visibility of a student to a company is decided only by `isStudentVisibleToCompany`; a hidden student returns 404. Only the Better Auth handler is exempt from the action/route wrappers.
4. Secrets and data. Never read or write `.env*` files; the template is `env.example`. No secrets in source, Docker ARG/ENV/COPY, NEXT_PUBLIC_* variables, CI files or GitHub Secrets. Tests and seeds use faker data only, with emails on example.test or example.com. Decrypted contact details, OTPs and tokens must never reach logs, AuditLog.metadata, Sentry events or Notification payloads.
5. Raw SQL and migrations. Use only `$queryRaw` / `$executeRaw` tagged templates or `Prisma.sql`; never `$queryRawUnsafe` / `$executeRawUnsafe`. Escape backslash, `%` and `_` before user input goes into ILIKE. Migrations only move forward: committed migrations are never edited or deleted; destructive SQL needs a `-- contract-approved: <reason>` comment and human approval. `prisma migrate reset`, `prisma db push`, `migrate deploy` and `migrate resolve` are never run by the AI.

## Raise to High
Treat any of the following as at least High severity in this project:
- An employer (or a visitor) can obtain any of a student's full name, phone, email, WhatsApp, WeChat, LinkedIn URL or resume storage key without an unlock or an application, through HTML, RSC payloads, JSON, notifications, emails, metadata or logs.
- `companyId`, `userId` or role is taken from client input, or a `require*` check is cached, skipped or done only in middleware.
- A Server Action or Route Handler is exported without `action()` / `route()`, or a non-GET route skips the Origin check.
- A new or changed `/api/auth/*` path is not covered by Turnstile verification (success, hostname and action checked; fail closed) and by rate limiting.
- Better Auth weakened: wildcard `trustedOrigins`, `disableCSRFCheck`, `useSecureCookies: false` in production, `cookieCache` enabled, `role` or `status` accepting input, email verification turned off.
- The client IP is read from X-Forwarded-For or any header other than X-Real-IP set by Caddy.
- Credits or quotas can be consumed twice, go negative, or be changed outside the ledger and quota services; an employer account is used to bypass the student job-view quota.
- Upload validation can be bypassed: no size limit, no magic-byte check, SVG/HTML/XML accepted, object key chosen by the client, encrypted or oversized PDFs accepted, or the bucket is public.
- A signed URL lives longer than 300 seconds, lacks `Content-Disposition: attachment`, or an export link exposes the storage domain.
- Responses for logged-in users or responses containing PII are cacheable (`'use cache'`, `unstable_cache`, `force-static`, missing `Cache-Control: private, no-store`), or a link to a counted page is prefetched.
- A hidden salary can be inferred from the job list, filters, details or metadata.
- Team invite tokens or OTPs stored in plaintext, compared without `timingSafeEqual`, reusable, or not bound to the invited email.
- Encryption without AAD, a reused IV, a key outside the PII key ring, or `decryptField` called outside contact-access.ts.
- Production config weakened: Postgres port published, app connecting as a superuser or as findmyjob_owner, production checks based on NODE_ENV instead of APP_ENV, Turnstile test keys accepted when APP_ENV=production, container running as root.
- A migration drops, renames or changes the type of a column, or sets NOT NULL, without the contract-approved comment, or edits an already committed migration.
- CI or GitHub Actions: `pull_request_target`, unpinned actions (not a 40-character SHA), write permissions at the top level, `github.event` values interpolated directly into `run`, or secrets referenced in ci.yml.

## Notes for reviewers
- Prefer citing the exact file and line. If a finding conflicts with this guidance, report the finding anyway and mention the conflict.
- Real company lists and real student data must never appear in the repository; flag any file that looks like real personal data (real names with phone numbers, non-example email domains) as High.
