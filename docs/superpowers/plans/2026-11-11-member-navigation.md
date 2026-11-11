# Member navigation implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the independent showcase task; keep route and shell integration together. Track steps below.

**Goal:** Separate guest discovery from member browsing, replace workspace sidebars with persistent role-aware top navigation and avatar menus, and deploy with the approved compact Logo.

**Architecture:** Reuse existing auth, job-search, company and settings services. Student browsing uses `/s/jobs` and `/s/companies`; public routes become curated previews and redirect authenticated students. Employer business pages retain existing authorization. A shared member header accepts serialized navigation/account data.

**Tech Stack:** Next.js App Router, React, next-intl, Tailwind, Radix primitives, Prisma, Vitest, Playwright.

## Global constraints

- Student and employer pages retain top navigation while editing profiles and settings; admin layout stays unchanged.
- Keep existing quota, authorization, privacy and consent rules. No production migrations are planned.
- Chinese and English, 375px, keyboard and reduced-motion support are required.
- Preserve other workspaces. Deploy using an isolated committed source archive and retain rollback images.

## Task 1: Reproduce navigation mismatch and build the member shell

Files: `tests/e2e/member-navigation.spec.ts`, `src/components/layout/member-header.tsx`, `member-navigation.tsx`, student/employer layouts, `messages/{zh,en}.json`.

Interfaces: `MemberHeader` consumes serialized user identity, role-specific primary and account link arrays, locale, counts and translated labels; all links use the locale-aware Link with prefetch disabled for member pages.

- [ ] Add a browser regression logging in a synthetic student, opening profile, clicking 找职位, asserting `/zh/s/jobs`, one main landmark and an avatar menu with no guest login link. Run against current code and observe failure.
- [ ] Implement top navigation, responsive Sheet, accessible avatar dropdown, role-aware navigation data, and layout integration. Preserve admin layout.
- [ ] Add employer role, mobile keyboard, sign-out and public navigation identity coverage; run relevant shell tests.

## Task 2: Separate member routes and migrate useful dashboard content

Files: new student jobs/companies routes; reusable job/companies list/detail components; public route wrappers; student profile; student/employer index; account actions; internal job links.

Interfaces: reusable lists accept `basePath`; JobCard accepts optional explicit `href`. Detail components accept member base paths and continue using existing job quota and application services.

- [ ] Assert old `/jobs` and `/companies` routes redirect students to member routes, search/filter/page links stay in that area, guest routes do not expose full search.
- [ ] Move existing list/detail rendering into reusable server components with explicit link bases; add authenticated wrappers and default entry redirects.
- [ ] Move student completeness/todos/recommendation content into profile context and employer verification notices into recruitment context. Add employer account editing using authenticated actions.
- [ ] Run route, account and role regression coverage, update expectations for intentionally replaced workspace navigation.

## Task 3: Curated public showcase and settings

Files and contracts are specified in `.reports/member-navigation/showcase-brief.md`. Worker owns new showcase components/schema/service and minimal admin settings extension; root owns public route wrappers and shared message-file integration.

- [ ] Test selected published-record ordering, exclusion of expired/private records, fallback/empty data and configuration validation.
- [ ] Implement public showcase components and minimal admin editor using existing audited settings service.
- [ ] Review worker diff and run tests for the affected configuration and public data paths.

## Task 4: Integration and release

- [ ] Integrate only the approved Wordmark change from the named chat. Compare exact diff and verify lint/formatting.
- [ ] Complete shared translations, member links, redirect safety and no-store checks; review all changed files.
- [ ] Run lint, typecheck, relevant unit/integration suites, browser regressions including admin and 375px, production build; record concrete results.
- [ ] Commit, build from clean source archive, upload/verify/load image, deploy app and worker with rollback, verify health/version/public routes and save release evidence.

## Progress

- Design approved by user in chat. Compact Logo integrated; eslint/prettier/diff checks pass.
- Implementation starting. No new navigation code deployed yet.
