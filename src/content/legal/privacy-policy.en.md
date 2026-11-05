# FindMYJob Privacy Policy

> **DRAFT – pending legal review** · 草案，待律师审阅
>
> This document is a draft for review by a Malaysian lawyer (DECISIONS D10). It is not legal advice and it is not a final text ready for publication. Every 【TO FILL】, 【TBD】 and 【TO VERIFY】 marker must be resolved before it is published.
>
> Version: `2026-11-draft` (same as the system setting `legal.currentVersion`)　Effective date: 【TO FILL F5: effective date】
>
> This policy has a Chinese and an English version with the same content. 【TBD T21: which language prevails if the versions differ; whether a Malay version must also be available at launch】

## 1. Who we are

FindMYJob (findmyjob.asia) is a website that helps students studying in Malaysia find internships and jobs. It is operated by 【TO FILL F1: operator's legal entity name】 (Malaysian company registration no. 【TO FILL F2: SSM registration no.】, address 【TO FILL F3: registered address】). "We" in this policy means that company.

For your personal data on FindMYJob, we are the data controller under Malaysia's Personal Data Protection Act 2010 (as amended in 2024, "PDPA").

Please send privacy questions to 【TO FILL F4: privacy contact email】. 【TBD T2: whether to appoint a Data Protection Officer (DPO); if so, state the DPO's title and contact details here】

## 2. Who this policy applies to

- Everyone who visits FindMYJob: visitors, student users, and employer users (OWNER, ADMIN and RECRUITER members of a company).
- This policy explains what we collect, why, who can see it, how long we keep it, how we protect it, and what rights you have.
- How employer users may use student data they obtain from FindMYJob is also governed by the Terms of Use.

## 3. What we collect

### 3.1 All visitors

| Data | When we collect it | What we use it for |
|---|---|---|
| IP address, browser type (user-agent) | Every visit | Security, abuse prevention, rate limiting |
| Human-verification signals | On the sign-up, sign-in, send-code and password-reset pages, collected by Cloudflare Turnstile | Telling humans from bots |
| Language preference | When you switch the interface language | Showing the site in your chosen language |
| Error reports | When a page or the server fails | Fixing faults (see Sentry in section 8) |

Our server logs record only the page route template, a request ID and internal IDs. They do not record full URLs or what you type into forms.

### 3.2 Student users

**Sign-up and account**
- Email, password (we store only a hash of your password and never see the original), interface language.
- If you sign up through a classmate's invite link: the invite code and the referral relationship.
- Consent records: the document version, time, IP address and browser information each time you give or withdraw consent.

**School verification**
- Your school, your school email (stored in lower case; one school email can verify only one account), and the verification time. Verification codes are stored only as hashes.
- 【TBD T5: whether students without a school email may upload a student card for manual review by our staff; if so, how ID numbers and photos on the card are handled and how soon the card is deleted after review】

**Profile (4-step wizard after sign-up)**
- Basic information: name, school, level of study, major, graduation month and year, CGPA (optional), nationality, work authorisation (Malaysian citizen / PR / student pass / dependant pass / will need a work pass after graduating / other).
- Job preferences: internship / full-time / part-time, earliest start date, preferred states, preferred industries, expected salary (optional).
- Skills: languages and proficiency, skill tags, one-line headline, self-introduction.
- Experience: education, internships / work, projects, campus activities, awards.
- Resume PDFs (optional; you may upload several); profile picture (optional).
- Nationality does not appear on the cards or detail pages employers can see. 【TBD T17: the purpose of collecting nationality; if there is no clear purpose, consider no longer collecting it】

**Contact details**: mobile number, contact email, WhatsApp, WeChat, LinkedIn. All stored encrypted. Who can see them is explained in section 6.

**Activity records**
- Applications (the resume you chose, your cover note, status changes) and employer invitations you received and answered.
- Which job details you opened (used to calculate your viewing quota).
- Whom you invited, who invited you, and whether each referral qualified.
- Jobs you reported and why; companies you blocked.
- Sign-in sessions (IP, browser information), in-app notifications, data requests you submitted.
- Security audit logs, for example sign-ins, talent-pool setting changes, export and deletion requests; these include IP addresses.

**What you must provide**
- To sign up you must provide an email and password and agree to the Terms of Use and this policy. Without them you cannot sign up.
- The profile wizard is a required step, but you can fill in most of it later. If your profile completeness is below 60 points, you cannot apply for jobs and you will not enter the talent pool (this number may change; the page shows the current value).
- CGPA, expected salary, resume PDFs, profile picture and each contact field are optional. After an employer unlocks you or receives your application, it sees only the contact details you filled in.
- Joining the talent pool is optional and off by default (see section 7).

### 3.3 Employer users

- **Account**: name, email, password (stored only as a hash), company, role in the company (OWNER / ADMIN / RECRUITER).
- **Company profile**: legal name, Chinese and English display names, SSM registration number, industry, size, website, address and state, description, logo.
- **Verification documents**: SSM certificate or business licence (up to 5 files), which may contain personal data of directors or the person handling the application. Our staff verify by calling back through public channels (SSM records, official website, public phone number) and record which channel was used and the result.
- **Team**: email addresses of invited members.
- **Activity records**: jobs posted, talent-pool detail views, unlocks, resume downloads, saved folders and notes, application-board statuses and internal notes, invitations to apply and their messages, credit ledger, sign-in sessions, audit logs (including IP).
- **Paid phase (not yet enabled)**: orders, bank-transfer receipts, invoicing details. Online payments are collected by the payment provider on its hosted page; we keep only the transaction reference. We will update this policy before this is enabled.

### 3.4 What we do not collect

We do not collect race, religion, identity card or passport numbers, or marital status. The only photo is a profile picture you choose to upload. Please do not put this information, or health information, in your resume or free-text fields. We do not need it.

### 3.5 Where the data comes from

- Almost all of it is entered or uploaded by you.
- School verification results come from the code sent to your school email.
- Referral relationships come from the invite link you used.
- Company verification results come from public channels (SSM records, official websites, public phone numbers).
- Application statuses, employers' internal notes and invitation messages are written by employer users.

## 4. What we use the data for

1. Opening and maintaining accounts; sending verification codes and notification emails.
2. Verifying that students are enrolled and that companies are genuine.
3. Letting students build profiles, search and apply for jobs; letting employers post jobs and handle applications.
4. Running the talent pool: with your consent, showing your anonymised profile to verified employers, and providing your contact details after an employer unlocks you.
5. Calculating job-viewing quotas and qualified referrals.
6. Preventing fraud and abuse: manual review of companies and jobs, handling reports, daily viewing and unlock limits, human verification, rate limiting, audit logging.
7. Security and troubleshooting: logs, error monitoring, backups and recovery.
8. Handling your data requests (export, correction, deletion) and support questions.
9. Aggregate statistics, for example sign-ups, applications and unlocks by school and by week, viewed only as totals in our admin console.
10. Complying with the law and with lawful requests from authorities.
11. Paid phase: processing employers' orders, payments and invoices.

What we **do not** do:
- Apart from the cases listed in section 6, we do not give your data to anyone. In the paid phase, employers buy credits to unlock contact details; this applies only to students who joined the talent pool, and only verified employers can do it.
- We do not currently send marketing emails. If we introduce them (for example weekly job recommendations), we will ask for your separate consent, and you can unsubscribe at any time.
- We do not currently send your data to any AI service. Before we do, we will update this policy and ask you to agree again.

## 5. Legal basis and your consent

- We mainly process your data on the basis of your consent. At sign-up you must tick to agree to the Terms of Use and this policy.
- "Join the talent pool" is a separate, optional consent. It is unticked by default.
- The PDPA allows some processing without separate consent, for example to perform our contract with you (providing the service you asked for) or to comply with a legal obligation.
- Each time you give or withdraw consent, we record the document version, time, IP address and browser information.
- How to withdraw consent is explained in section 12.

## 6. Who can see your data

### 6.1 What verified employers see in the talent pool (before unlocking)

You appear in the talent pool only if all of these are true: you chose to join it, your school is verified, your profile completeness is at least 60 points (may change), and your account is in good standing. Companies you have blocked cannot find you.

- **Search card**: student ID, masked name (Chinese names show the surname plus "同学", including compound surnames; other names show initials only), school, level of study, major, graduation month and year, work authorisation, languages, skills, headline, last active time.
- **Detail page**: the card, plus your experience (education, internships / work, projects, campus activities, awards) and a preview of your structured resume.
- Any email address, phone number, URL or WeChat ID in free text is shown as "[已隐藏]" (hidden).
- Employers cannot see your full name, contact details or original resume PDF.
- Employers can filter by school, major, level of study, graduation year, job type wanted, languages, work authorisation, skills, preferred states, earliest start date and last active time. Some of these are not shown on the card, but employers can infer them from filter results.
- **Anonymised does not mean impossible to recognise**: someone who knows you might recognise you from your school, major, graduation date and internship employers taken together.
- We record every time an employer opens your detail page. Under "Who viewed me" in your Privacy Centre you can see which companies viewed you in the last 90 days, and when.
- Employers can add you to folders shared within their company and write notes. You cannot see these notes.

### 6.2 After an employer unlocks you

When a verified employer unlocks you using credits (given free during the pilot), it can see your full name and contact details and download your resume PDFs. Every page of a downloaded resume carries a watermark: "For {company name} recruitment only · {date} · {operator ID}".

- A company needs to unlock a student only once; the unlock is shared within that company's team.
- You are notified; "Who unlocked me" in your Privacy Centre lists the companies that unlocked you, and when.

### 6.3 After you apply or accept an invitation

When you apply for a job (accepting an employer's invitation to apply also counts as applying), the company that posted it automatically gets the same access as an unlock: full name, contact details, resume download. This applies even if you have not joined the talent pool or your school is not yet verified. The company does not spend credits.

That company also sees the resume and cover note you submitted, and a standardised list: name, school, major, level of study, graduation month and year, CGPA, work authorisation, languages, number of internships, number of campus activities, profile completeness. You cannot see the internal notes the employer writes about your application.

### 6.4 When employers stop seeing you

- **You block a company**: it can no longer find you. Even if it unlocked you or received your application before, the platform no longer shows it your full name or contact details, and it can no longer download your resume.
- **You request account deletion, or your account is suspended**: no employer can see you.
- **You turn off the talent pool, or withdraw an application**: you disappear from talent-pool search immediately and new employers cannot find you. But companies that already unlocked you, or that received your application, can still see your full name and contact details on the platform until you block them or delete your account. 【TBD T15: lawyer to confirm whether this arrangement is acceptable after consent is withdrawn】

### 6.5 Data that employers take off the platform

An employer may copy down your contact details or download your resume. Once data leaves the platform, it is outside our control. Under the Terms of Use, employers may use this data only for recruitment, must not sell or pass it to others, and must delete it when no longer needed; employers are themselves responsible for this data under the PDPA. 【TBD T28: whether the employer is an independent data controller for this data, and whether the platform and employers need a separate agreement】

If you think a company has misused your data, please tell us (【TO FILL F4: privacy contact email】). We can suspend that company's account. You can also contact the company directly, or complain to the Personal Data Protection Commissioner.

### 6.6 Other users and the public

- **Your referrer**: if you signed up through a classmate's invite link, that classmate can see your masked name, profile completeness and referral status on their quota page.
- **The public**: student profiles are not public. Company pages (logo, description, open jobs) and job lists are public.

### 6.7 FindMYJob staff

- Authorised staff each have their own account and look at data only when their work needs it: reviewing companies and jobs, handling reports, support, data requests, investigating fraud or abuse.
- Staff can view student contact details only one person at a time, and every view is written to the audit log. Every action in the admin console is written to the audit log.
- Some company accounts are created and have jobs posted by our staff on the company's behalf ("managed companies"), and are later handed over to the company itself. 【TBD T24: whether, during the managed period, staff may search the talent pool and unlock students as that company】

### 6.8 Who can see employer users' data

- The public and students: what is on the company page (display name, logo, description, industry, size, website, state, open jobs).
- Students: the company name and time in "Who viewed me" and "Who unlocked me"; the company name in application statuses and invitations; the company name, date and operator ID in resume watermarks.
- Our staff: verification documents and verification records.

### 6.9 Service providers and legal disclosure

- Service providers that help us run the website are listed in section 8.
- When the law requires it, or where the PDPA allows it to prevent fraud, crime or serious harm, we may provide data to the police, courts or other authorities.

## 7. The talent pool: joining and leaving

- You are not in it by default. You can choose to join at sign-up or later in your Privacy Centre.
- After joining, you actually appear only once your school is verified, your profile completeness is at least 60 points (may change) and your account is in good standing.
- You can turn the talent pool off at any time in your Privacy Centre. It takes effect immediately; for the effect on companies that already unlocked you, see 6.4.
- You can block specific companies in your Privacy Centre.
- You can apply for jobs without joining the talent pool.

## 8. Service providers (sub-processors)

We give service providers only the data they need for their task. No service provider receives decrypted student contact details.

**Providers that process personal data**

| Provider | What it does | What data it handles | Location |
|---|---|---|---|
| Cloud hosting and object storage: 【TBD T1: provider name (D1 / D24); default Amazon Web Services】 | Runs the website and database; stores resumes, verification documents, logos, export packages and encrypted backups | All production data (contact details are encrypted before storage); backups are separately encrypted | Malaysia region |
| Email: Resend 【TBD T3: final choice of email provider (D4)】 | Sends verification codes, notifications and reminder emails | Recipient email and email content, including codes and notification content (for example, the application digest an employer receives may include student names and profile summaries); never contact details | 【TO VERIFY V1: Resend's data-processing location】 |
| Sentry | Error monitoring | Error messages, the page route where the error happened, software version, browser type. Designed to exclude personal data: no cookies, form content or user identity are sent, and no screen recording. Browser-side error reports are sent directly from your browser to Sentry. 【TO VERIFY V6: the Sentry project is set not to store IP addresses】 | European Union |
| Cloudflare Turnstile | Human verification | IP address, browser signals, verification token | 【TO VERIFY V2: Cloudflare Turnstile's data-processing location】 |

**Providers that by design receive no user personal data**

| Provider | What it does | Data involved | Location |
|---|---|---|---|
| UptimeRobot | External availability monitoring | Only calls the health-check address; no user data | 【TO VERIFY V3: locations of UptimeRobot and healthchecks.io】 |
| healthchecks.io | Heartbeat monitoring for backups and scheduled jobs | Job names and times; no user data | 【TO VERIFY V3】 |
| GitHub | Code hosting and automated tests | Source code and fictional test data; no user data | 【TO VERIFY V4: GitHub's data-processing location】 |
| Development-time AI coding service (via a third-party relay) | Helps with development | Source code and fictional test data; no user data | 【TO VERIFY V5: the relay's location and data-retention terms】 |

**Not yet enabled**

| Provider | Planned use | Before enabling |
|---|---|---|
| Stripe | Online payments in the paid phase; employers enter payment details on Stripe's page | Update this policy |
| Anthropic API | Resume parsing, generating job descriptions | Update this policy and ask you to agree again |

## 9. Cross-border transfers

- The database, files and backups are all kept in a Malaysia region.
- The following data goes outside Malaysia: error reports sent to Sentry (European Union); for Resend and Cloudflare, it depends on where they actually process data (【TO VERIFY V1】【TO VERIFY V2】). GitHub and the development-time AI service only handle code and fictional data.
- Basis for transfer: 【TBD T16: which ground under section 129 of the PDPA (as amended in 2024) the transfers rely on, and whether your separate consent is needed】.
- Our safeguards: we send only what is needed; error reports are stripped of personal data before sending; contact details are never given to any service provider.

## 10. How long we keep data

| Data | How long |
|---|---|
| Sign-ups whose email is not verified | Deleted if not verified within 48 hours |
| Email verification codes | Expire after 10 minutes; stored only as hashes |
| Profile, resumes and contact details while your account exists | Until you change or delete them, or request account deletion |
| After you request account deletion | Your account is deactivated and removed from the talent pool immediately, and employers can no longer see your full name or contact details on the platform. After 30 days we permanently delete your contact details, resume files (including every stored historical version), name and email, cover notes, notes employers wrote about you, notification content and export packages, and anonymise the rest of your profile. 【TBD T13: whether a deletion request can be cancelled within these 30 days】 |
| Credit ledger and audit logs | After account deletion, only internal IDs remain, without your name or contact details. 【TBD T8: how long audit logs (including IP addresses) are kept, and whether IP addresses are anonymised on account deletion (D22)】 |
| Backups | The database is backed up daily in encrypted form and backups are kept for 30 days. Deleted data may remain in backups for up to 30 more days and disappears as the backups expire |
| Old versions of replaced or deleted files | Expire after 30 days |
| Data export packages | The download entry is valid for 24 hours. 【TBD T6: how long the export file itself is kept (proposed: deleted with all versions after 24 hours)】 |
| Records of employers viewing your profile | "Who viewed me" shows only the last 90 days. 【TBD T7: how long the records themselves are kept】 |
| Consent records, and IP and browser information in sign-in sessions | 【TBD T9: how long】 |
| Notifications, application records, closed jobs | 【TBD T10: how long】 |
| Employer accounts, company profiles and verification documents; orders and invoices in the paid phase | 【TBD T11: how long; how a company closes its account and deletes its data】 |
| Server logs and error reports | 【TBD T12: how long】 |

We cannot delete emails that have already been sent, or data that employers have taken off the platform (see 6.5).

## 11. How we protect your data

- The whole site uses HTTPS.
- Contact details are stored encrypted (AES-256-GCM) and are decrypted on the server only when an employer has unlocked you, you have applied, you view them yourself, or staff view them under 6.7.
- Resumes and verification documents are kept in private storage and can only be reached through links valid for no more than 5 minutes; resumes downloaded by employers are rebuilt and watermarked on every page.
- Free text shown to employers automatically hides contact details.
- Human verification, sign-in rate limits, daily viewing and unlock limits; no bulk export of the talent pool.
- Each staff member has their own account; unlocks, views, downloads, credit changes and admin actions are all audit-logged.
- The database is backed up daily, encrypted, to a Malaysia region; the backup credentials on the server cannot delete existing backups.
- During the pilot, all company verifications and job postings are reviewed manually.

No system can guarantee perfect security. If a data breach happens, we will notify as described in section 13.

## 12. Your rights and how to use them

| What you want to do | How |
|---|---|
| Access or export your data | "Export my data" in your Privacy Centre gives you a package of JSON files and your resume files. We email you a notice containing only a link to the site; when you open it while signed in within 24 hours, the system creates a download link valid for no more than 5 minutes |
| Correct your data | Edit your profile directly; for anything you cannot change yourself (for example a verified school email), write to 【TO FILL F4: privacy contact email】 |
| Delete your data | "Request account deletion" in your Privacy Centre; the effect is described in section 10 |
| Withdraw talent-pool consent | Turn off the talent-pool switch in your Privacy Centre at any time (effect described in 6.4) |
| Withdraw consent to the Terms of Use and this policy | You can no longer use your account; please request account deletion |
| Limit which employers can see you | Block companies, or turn off the talent pool |
| See who viewed or unlocked you | "Who viewed me" and "Who unlocked me" in your Privacy Centre |
| Refuse marketing | We do not currently send marketing emails; when we do, you can unsubscribe at any time |
| Complain | Contact us first (【TO FILL F4】); you can also complain to Malaysia's Personal Data Protection Commissioner |

- Self-service actions in the Privacy Centre are free.
- We only accept requests made from your own signed-in account or sent from your registered email, and may ask you to confirm your identity further.
- We respond to access and correction requests within 21 days. 【TO VERIFY V8: the response deadline under the PDPA (PRD default: 21 days)】 Deletion requests follow the timetable in section 10.
- If the law requires us to keep some data, or the PDPA allows us to refuse a request, we will tell you why.
- Employer users have the same rights over their own personal data (name, email, etc.).

## 13. Data breach notification

If a data breach happens that may cause you significant harm, we will:
- notify the Personal Data Protection Commissioner within 72 hours of becoming aware of it;
- tell affected users within 7 days, by email and in-app notification: what happened, what data was involved, what we have done and what you can do.

【TBD T26: these deadlines are subject to the lawyer's advice (D10 ③)】

## 14. Cookies and similar technologies

We use only what is needed to run the website. We do not use advertising or analytics cookies and do not track you across websites.

| Name | Purpose | How long |
|---|---|---|
| Sign-in cookie | Keeps you signed in (httpOnly, secure) | Until you sign out or the session expires |
| Language-preference cookie | Remembers your interface language | 【TO VERIFY V7: name and lifetime of the language cookie】 |
| Cloudflare Turnstile | Human verification on the sign-up, sign-in, send-code and password-reset pages | Set by Cloudflare (【TO VERIFY V2】) |
| Offline cache (PWA) | After you add the site to your home screen, caches the offline page and icons | Until you remove the app or clear browser data |

Before we use any other cookies or similar technologies, we will update this policy.

## 15. Minors

FindMYJob is for students at diploma and university level and is not aimed at people under 18, but some foundation students may be under 18.

【TBD T4: minimum age and handling of minors. Proposed approach (A-27, not decided): sign-up requires ticking "I am 18 or older", and people under 18 cannot sign up for now; after the lawyer's advice, decide whether minors may sign up with guardian consent and whether they may join the talent pool】

If you are a parent or guardian and find that a child under 18 has signed up, please contact 【TO FILL F4: privacy contact email】.

## 16. Changes and agreeing again

- Every version has a version number. The current version is `2026-11-draft`.
- When the version number changes, you will be asked to read and agree again the next time you sign in before you can continue. 【TBD T14: whether users who do not agree to a new version can still sign in to export or delete their data】
- Before adding a service provider that will receive your data (for example an AI service), we will update this policy first.

## 17. Contact us

- Operator: 【TO FILL F1: operator's legal entity name】 (【TO FILL F2: SSM registration no.】)
- Address: 【TO FILL F3: registered address】
- Privacy matters: 【TO FILL F4: privacy contact email】
- Data Protection Officer: 【TBD T2】
