# Expandable Browsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add expandable job details and a company selection panel to member browsing, verify and deploy.

**Architecture:** A student-layout parallel route intercepts job details into an accessible Motion/Radix dialog. The same server detail component serves direct and modal views. Company selection uses server-rendered query state with a sticky detail panel and independent job pagination.

**Tech Stack:** Next.js 16.4.5, React, next-intl, Motion 14.10.1, Radix Dialog, Prisma, Playwright.

## Global Constraints

- Approved spec: `docs/superpowers/specs/2026-11-12-expandable-browsing-design.md`.
- Preserve authentication, quotas, hidden salary, published/deadline checks, apply/report/share behavior and student navigation.
- No database migrations or new dependencies; no job-detail prefetch or protected data in lists.
- Keyboard/Escape/focus restoration, nested dialogs and reduced motion must work in Chinese, English and at 375px.
- RTK shell wrapper, manual changes through apply_patch, current installed Next.js docs, preserve original Claude workspace.
- Worker scopes are disjoint. Only one browser suite may run at a time. Use synthetic isolated test DBs via `.reports/member-navigation/verify.mjs`.

## Task 1: Job grid and route modal

**Files:**
- Modify `src/app/[locale]/s/layout.tsx`, `src/app/[locale]/s/jobs/page.tsx`, `src/components/jobs/job-card.tsx`, `src/components/jobs/job-detail-page.tsx`.
- Create student `@modal/default.tsx`, `@modal/[...catchAll]/page.tsx`, `@modal/(.)jobs/[id]/page.tsx` and loading/error/not-found boundaries as required.
- Create focused modal/animation client components in `src/components/jobs/`.
- Add `jobBrowser` labels to `messages/zh.json` and `messages/en.json`.
- Test `tests/e2e/expandable-browsing.spec.ts` (root owns this file).

**Interfaces:**
- Keep existing `JobCard` props compatible. Member job links participate in shared-layout animation; all links remain actual anchors with `prefetch={false}`.
- Add optional `presentation?: 'page' | 'modal'` to `JobDetailPage`; default remains page.
- Modal shell takes server-rendered children and uses router back on close; stable accessible name comes from `jobBrowser.details`.

- [x] Root adds behavioral tests and runs red: clicking a real job must produce `page.getByRole('dialog', {name: '职位详情', exact: true})`, preserve search on close, spend only one unique view and support nested apply Escape.
- [x] Implement responsive `grid gap-4 sm:grid-cols-2 xl:grid-cols-3` within a suitably wide browsing container.
- [x] Add route slot to student layout, default/catch-all null fallbacks and an authenticated intercept leaf. Use existing job detail and compact modal presentation; preserve direct detail routes.
- [x] Add shared-layout card/dialog transitions and reduced-motion behavior; use Radix for focus/scroll/nested-dialog semantics, restore original card focus on close, handle loading/errors without trapping users.
- [x] Change member job detail enterprise link to `/s/companies?company=${job.companyId}`.
- [x] Run targeted ESLint/typecheck and the job tests. Root performs browser runs, avoiding server collisions; record results before commit.

## Task 2: Company grid and pinned jobs

**Files:**
- Modify `src/app/[locale]/s/companies/page.tsx`.
- Create `src/components/company/company-browser.tsx` for selection/transition/scroll interactions and `src/components/company/company-jobs-panel.tsx` for safe server rendering, or equivalent focused units.
- Create `src/server/services/company-browse.ts` for the safe published jobs query.
- Add `companyBrowser` labels to `messages/zh.json` and `messages/en.json`.
- Test `tests/integration/company-browse.test.ts` and root-owned `tests/e2e/expandable-browsing.spec.ts`.

**Interfaces:**
- Query state: `tag`, `cursor` (company list), `company` (CUID), `jobsCursor` (job list). Filter and company-page navigation reset selection; selection resets jobsCursor and preserves tag/cursor.
- `listCompanyBrowseJobs(companyId: string, cursor?: string)` returns only active verified-company published, unexpired job summaries, `items` and `nextCursor`; hidden salaries are null in returned summaries.
- Existing JobCard links `/s/jobs/${job.id}` automatically use Task 1's modal.

- [x] Add integration red case with verified/inactive companies, published/draft/expired jobs and hidden salaries; expect only eligible summaries, no descriptions and distinct cursor pages.
- [x] Root's browser red checks company selection remains on `/s/companies?company=...`, yields an inline panel rather than dialog, and opens its jobs into the shared modal.
- [x] Replace member carousel with left two-column company cards and right `lg:sticky` panel below navigation; serve selection safely from query state and show explicit missing/loading/empty states.
- [x] Render selected company identity, safe website, description and job cards with independent pagination. Default to first current company. Support valid externally selected company outside current list.
- [x] On narrow layouts, place panel below grid and scroll/focus its heading after user selection. Keep visible selected state and live selection feedback.
- [x] Run the integration test, targeted ESLint/typecheck and company browser cases. Review summary and diff before commit.

## Task 3: Integrated verification, review and release

**Files:**
- `tests/e2e/expandable-browsing.spec.ts`; adjust existing browser assertions only where intended layout changes require it.
- `.reports/expandable-browsing/` verification, screenshots, source review and release evidence.

- [x] Run new browser suite plus `redesign-public.spec.ts`, `redesign-home-job.spec.ts`, `member-navigation.spec.ts`, `member-review.spec.ts`, `pii-leak.spec.ts`; capture desktop and mobile screenshots.
- [x] Run `rtk pnpm lint`, `rtk pnpm typecheck`, appropriate quota/search/company integration tests; inspect all exit statuses.
- [x] Review the complete change for approved scope, accessibility, URL history and quotas. Resolve findings and repeat affected tests.
- [ ] Commit verified implementation and build a clean Git archive Docker image with full revision in `build.json`.
- [ ] Adapt existing release helpers into the new report directory. Expected production revision is `610cfc679ba0b477496860b3dd68399e71d3cd7c`, not the prior helper's older baseline. Preserve rollback and no schema drift.
- [ ] Upload image and activate app/worker only; verify healthy UID1000 runtimes, matching revision, no new errors and public routes on `https://findmyjob.asia`.
- [ ] Record final evidence and report the deployed interaction and relevant verification.

## Review

All approved spec areas map to tasks above. Modal/side-panel behavior, query parameters, quota triggers, mobile layout and deployment baseline are explicit. Browser tests run serially; implementation workers do not overlap file ownership.
