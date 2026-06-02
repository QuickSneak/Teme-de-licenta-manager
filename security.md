# Security Review Notes

This document records security findings from the current implementation review and the runtime checks performed against the local Bun/Elysia server.

Status note: Phase 1 remediation has been implemented for the protected-page authorization and static source exposure findings. Phase 2 remediation has been implemented for local SQLite tracking and production auth secret handling. Phase 3 remediation has been implemented for stored-XSS hardening and text length limits. Phase 4 remediation has been implemented for same-origin checks and baseline security headers. Phase 5 remediation has been implemented for SQLite foreign keys, lifecycle indexes, and transactional lifecycle mutations. Phase 6 remediation has been implemented for app-level rate limiting. The original findings remain below for audit context.

## Runtime-Confirmed Findings

### 1. Protected HTML pages are served before authorization

Severity: High

Status: Addressed in Phase 1 by serving protected HTML through server-side role checks.

Original confirmed behavior: unauthenticated requests to protected page shells returned the full HTML. A logged-in student could also request professor-only HTML and receive `200 OK`.

Confirmed examples:

- `GET /professor-dashboard.html` while unauthenticated returned `200`.
- Logged in as `student.test.info23@uab.ro`, `GET /professor-dashboard.html` returned `200`.
- The same student received `403` from `GET /api/professor/dashboard`.
- Unauthenticated `GET /api/professor/dashboard` returned `401`.

Impact:

The API authorization layer is mostly doing the right thing, but page access is only protected by client-side JavaScript. This causes the visible cross-role page flash and means protected page structure, embedded static content, and client logic are exposed before redirect.

Recommended fix:

Serve protected HTML through server-side routes that check the session and role before returning the file. Public static serving should not handle protected pages.

### 2. Source files under `src` are publicly accessible

Severity: High

Status: Addressed in Phase 1 by moving public browser assets to `public` and removing `src` from static serving.

Original confirmed behavior: the app served the entire `src` directory through `staticPlugin({ assets: 'src', prefix: '' })`.

Confirmed examples:

- `GET /auth.ts` returned source code.
- `GET /seed.ts` returned source code and includes seeded test passwords.
- `GET /db/schema.ts` returned source code.

Impact:

This exposes internal implementation details, schema structure, auth configuration, seed credentials, API logic, and any future sensitive code placed under `src`.

Recommended fix:

Move browser-served files into a dedicated public directory, for example `public/`, and configure static serving only for that directory. Keep server code, DB schema, seed scripts, and TypeScript sources outside the static root.

### 3. Root path traversal probes did not succeed

Severity: Informational

The following probes returned `404` during runtime testing:

- `GET /%2e%2e/sqlite.db`
- `GET /%2e%2e/.env.local`

Impact:

Arbitrary root traversal was not confirmed in the current local runtime. The confirmed issue is public access to files inside the configured static root.

Recommended fix:

Still reduce the static root to a dedicated public directory. This removes the class of issue instead of relying on route normalization behavior.

## Source-Review Findings

### 4. `sqlite.db` is tracked by git

Severity: High

Status: Addressed in Phase 2 by ignoring local SQLite database files and removing `sqlite.db` from git tracking while leaving the local file on disk.

`git ls-files` shows `sqlite.db` is tracked.

Impact:

SQLite databases can contain password hashes, session tokens, verification records, password reset tokens, private user data, and test accounts. Keeping the DB in git makes accidental disclosure much more likely.

Recommended fix:

Stop tracking `sqlite.db`, add it to `.gitignore`, and treat local databases as environment-specific runtime state. If this repository has been shared, rotate all secrets and invalidate sessions/tokens from any exposed database.

### 5. Stored XSS risk in `professors.html`

Severity: High

Status: Addressed in Phase 3 by replacing user-controlled `innerHTML` rendering with DOM node creation and `textContent`.

Most frontend rendering uses `textContent`, which is good. However, `professors.html` injects database-controlled values into `innerHTML`, including professor names and topic fields.

Relevant patterns:

- Professor name interpolation in link/header HTML.
- Topic title, summary, and status interpolation in topic card HTML.

Impact:

A malicious or compromised professor account could store HTML/JavaScript in a profile or topic field and execute code in a student's browser.

Recommended fix:

Replace user-controlled `innerHTML` rendering with DOM node creation plus `textContent`. Only use `innerHTML` for static templates with no user-controlled interpolation.

### 6. Auth secret has an unsafe fallback

Severity: High for production, Medium for local-only development

Status: Addressed in Phase 2 by failing production startup when `BETTER_AUTH_SECRET` is missing, a known placeholder, or shorter than 32 characters.

`BETTER_AUTH_SECRET` falls back to `dev-secret-change-before-production`.

Impact:

If deployed without a real secret, sessions and auth-related tokens may rely on a known shared secret.

Recommended fix:

Fail fast when `BETTER_AUTH_SECRET` is missing outside local development. Use a long random value from environment configuration.

### 7. App-owned state-changing routes lack explicit CSRF protection

Severity: Medium-High

Status: Addressed in Phase 4 by adding a centralized same-origin check for app-owned `POST`, `PUT`, `PATCH`, and `DELETE` routes. Better Auth routes under `/api/auth/*` remain delegated to Better Auth.

Original finding: Better Auth routes appear to have their own origin/CSRF protections, but app routes such as `/logout`, `/profile`, student request routes, professor accept/reject routes, topic mutations, and notification clearing do not show explicit CSRF or same-origin enforcement.

Impact:

Because auth is cookie-based, another site may be able to trigger state-changing requests from a logged-in browser unless SameSite and/or origin checks reliably block them.

Implemented behavior:

- App-owned unsafe methods validate `Origin` first, then `Referer` when `Origin` is absent.
- Trusted origins come from `APP_URL` and `BETTER_AUTH_URL`; local development also allows the current request origin and `http://localhost:3000`.
- Requests without either header are still allowed so non-browser tools and scripts are not broken.
- `/api/auth/*` is excluded from the app-level gate so Better Auth can enforce its own policy.

Remaining hardening option:

- Add synchronizer CSRF tokens for especially sensitive browser forms/actions if the app later needs stronger protection than same-origin header validation plus SameSite cookies.
- Keep session cookies `HttpOnly`, `Secure` in HTTPS production, and `SameSite=Lax` or stricter.

### 8. Business invariants depend on app checks without transactions

Severity: Medium-High

Status: Addressed in Phase 5 by adding partial unique indexes and wrapping high-risk lifecycle mutations in transactions with conditional updates.

Original finding: Rules like "one pending request per student", "one active assignment per student", and "topic can only be claimed once" were checked in application code before writes.

Impact:

Concurrent requests can race between the check and the write, creating duplicate pending requests, multiple active assignments, or inconsistent topic reservation state.

Implemented behavior:

- `topic_requests_one_pending_student_unique`: one pending thesis request per student.
- `topic_requests_one_pending_claim_topic_unique`: one pending topic claim per topic.
- `topic_assignments_one_active_student_unique`: one active assignment per student.
- `topic_change_requests_one_pending_assignment_unique`: one pending edit request per assignment.
- Topic claim creation, custom proposal creation, professor accept/reject, edit request accept/reject, assignment abandon, edit request creation, and pending request expiration now use transaction blocks for related reads/writes.
- Topic reservation, request status, assignment status, and edit request status changes use conditional updates where the previous state still matters.

Remaining hardening option:

- Add broader integration tests around concurrent request attempts once the project has a test runner.

### 9. SQLite foreign keys are not explicitly enabled

Severity: Medium

Status: Addressed in Phase 5 by enabling `PRAGMA foreign_keys = ON` immediately after opening the SQLite connection.

Original finding: The schema defines foreign keys, but the database connection did not explicitly enable `PRAGMA foreign_keys = ON`.

Impact:

SQLite may not enforce referential integrity unless this pragma is enabled for the connection. That can leave orphan rows and weaken authorization assumptions based on relationships.

Implemented behavior:

Foreign keys are enabled for the app's SQLite connection in `src/db/index.ts`.

### 10. No security response headers are configured

Severity: Medium

Status: Addressed in Phase 4 by applying baseline security headers to app responses, protected/public HTML, Better Auth responses, redirects, JSON responses, and public static assets.

Original finding: The app did not show centralized security headers such as:

- `Content-Security-Policy`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options` or CSP `frame-ancestors`
- `Referrer-Policy`
- `Permissions-Policy`

Impact:

Security headers provide defense in depth against XSS, clickjacking, MIME sniffing, and unwanted browser feature access.

Implemented behavior:

- `Content-Security-Policy`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy`

The current CSP intentionally allows inline scripts and inline styles because the existing HTML pages still use inline script/style blocks. Tightening `script-src` and `style-src` should happen after those are moved into external files or nonce/hash-based CSP support is added.

### 11. Input validation is minimal for user-generated text

Severity: Medium

Status: Addressed in Phase 3 for registration/profile names, profile bios, topic titles/descriptions, custom proposals, and assignment edit requests.

Fields such as names, bios, topic titles, descriptions, and proposal text are mostly trimmed and checked for presence, but there are no clear length limits or content constraints.

Impact:

This can lead to oversized payloads, UI breakage, database bloat, log noise, and increased XSS impact if a rendering bug exists.

Recommended fix:

Define server-side maximum lengths for each field and enforce them consistently. Keep client-side validation as UX only.

### 12. Authentication and mutation endpoints lack app-level rate limiting

Severity: Medium

Status: Addressed in Phase 6 with in-memory app-level rate limits for authentication-adjacent routes and mutation-heavy student actions.

Original finding: Better Auth may rate-limit some auth endpoints internally, but app-owned endpoints do not show rate limits. Login and registration behavior should also be verified explicitly.

Impact:

Brute-force attempts, spam registrations, proposal spam, notification abuse, and repeated mutation calls are easier without rate limits.

Implemented behavior:

- Login: 30 attempts per IP per 15 minutes.
- Login failures: 5 failed attempts per email per 15 minutes. A successful login clears that email's failed-login bucket.
- Registration: 5 attempts per IP per 20 minutes and 3 attempts per email per 20 minutes.
- Password reset request: 10 attempts per IP per 20 minutes and 3 attempts per email per 20 minutes.
- Verification email resend: 10 attempts per IP per 20 minutes and 3 attempts per email per 20 minutes.
- Student topic claims and custom proposals: 20 actions per authenticated user per day.
- Student assignment edit requests: 20 submissions per authenticated user per day.
- General authenticated non-GET app mutations: 300 actions per authenticated user per hour.

The current limiter is process-local memory. It is appropriate for this local/single-server app stage and easy to tune, but a production deployment with multiple server instances should move these counters into shared storage.

### 13. Professor self-registration is broad

Severity: Medium

Any non-student-format `@uab.ro` address can register as a professor.

Impact:

If access to an email address under the domain is not a sufficient professor proof, unauthorized staff or aliases could obtain professor privileges.

Recommended fix:

Prefer invitation/admin approval for professor accounts, or require secretary/admin assignment before professor capabilities become active.

### 14. Email templates interpolate URLs into HTML without escaping

Severity: Low-Medium

Verification and password reset emails place generated URLs directly into HTML attributes.

Impact:

The URL is currently generated by the auth flow/application config, so this is not immediately user-controlled in normal operation. It is still better practice to HTML-escape values placed into email templates.

Recommended fix:

Escape HTML attribute/text values in email templates.

### 15. Public pages and protected pages are mixed in the same directory

Severity: Medium

Auth pages, protected dashboards, JavaScript, CSS, server code, DB code, and seed scripts currently live under `src`.

Impact:

This makes static exposure mistakes more likely and makes it harder to reason about public versus private assets.

Recommended fix:

Separate server and client/public files:

- `src/` for server TypeScript and backend modules.
- `public/` for browser HTML/CSS/JS/assets.
- Server-owned route handlers for protected HTML.

## Suggested Patch Phases

### Phase 1: Static boundary and server-side page authorization

Status: Implemented.

Goal:

Eliminate the most visible and most dangerous access-control issue.

Work:

- Move public browser assets into a dedicated public directory.
- Stop serving all of `src`.
- Serve protected HTML through role-checked server routes.
- Keep public auth pages accessible without a session.
- Preserve existing URLs where practical.

Expected risk:

Moderate. This touches routing and file layout, so browser testing is important.

### Phase 2: Repository and runtime secret hygiene

Status: Implemented.

Goal:

Prevent accidental leakage of database contents and auth secrets.

Work:

- Add `sqlite.db` to `.gitignore`.
- Stop tracking the current database file.
- Add a clear local DB setup note.
- Make production boot fail if `BETTER_AUTH_SECRET` is missing.
- Review `.env.example` for safer guidance.

Expected risk:

Low to moderate. Git/file-state changes should be handled carefully to avoid deleting the user's local working database.

### Phase 3: XSS hardening and input limits

Status: Implemented.

Goal:

Prevent stored user content from becoming executable browser code.

Work:

- Replace unsafe `innerHTML` rendering in `professors.html`.
- Audit remaining `innerHTML` uses and document which ones are static-only.
- Add server-side length limits for names, bios, titles, descriptions, and proposal text.
- Optionally add basic client-side length UX after server enforcement.

Expected risk:

Low to moderate. Mostly localized frontend changes plus validation behavior.

### Phase 4: CSRF and security headers

Status: Implemented.

Goal:

Add browser-level defense in depth for authenticated actions.

Work:

- Add same-origin checks for app-owned non-GET routes.
- Confirm Better Auth route compatibility.
- Add security headers.
- Start with a CSP that does not break existing inline scripts, then tighten later if inline scripts are moved out.

Expected risk:

Moderate. Header and origin policy changes can break legitimate flows if configured too aggressively.

### Phase 5: Database integrity and race-condition fixes

Status: Implemented.

Goal:

Make important business rules durable under concurrency.

Work:

- Enable SQLite foreign keys on connection.
- Add transactions around multi-step lifecycle operations.
- Add partial unique indexes for one pending request per student and one active assignment per student.
- Use conditional updates for topic reservation and review actions.

Expected risk:

Moderate to high. Requires migration work and careful testing of thesis lifecycle flows.

### Phase 6: Abuse controls and account governance

Status: Implemented for abuse controls. Professor registration and activation policy is intentionally unchanged for now.

Goal:

Reduce misuse once core access controls are solid.

Work:

- Add rate limits for login, registration, reset email, proposal submission, and mutation-heavy routes.
- Revisit professor registration policy later when the secretary faculty/professor assignment page is implemented.
- Consider admin/secretary approval for professor activation later if product policy requires it.
- Add audit logging for sensitive actions.

Expected risk:

Moderate. Some product decisions are involved, especially professor onboarding.

## Implementation Strategy

The safest first implementation batch is Phase 1 only.

Phase 1 addresses the two highest-impact confirmed runtime findings:

- Protected pages are served before authorization.
- Source files are publicly accessible.

It is large enough to materially improve security, but still focused enough to debug if routing or static assets break. After that, Phase 2 is a good separate follow-up because it changes repository/runtime hygiene rather than browser behavior.
