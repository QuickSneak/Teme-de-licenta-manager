# Security Review Notes

This document records security findings from the current implementation review and the runtime checks performed against the local Bun/Elysia server.

Status note: Phase 1 remediation has been implemented for the protected-page authorization and static source exposure findings. Phase 2 remediation has been implemented for local SQLite tracking and production auth secret handling. The original findings remain below for audit context.

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

Better Auth routes appear to have their own origin/CSRF protections, but app routes such as `/logout`, `/profile`, student request routes, professor accept/reject routes, topic mutations, and notification clearing do not show explicit CSRF or same-origin enforcement.

Impact:

Because auth is cookie-based, another site may be able to trigger state-changing requests from a logged-in browser unless SameSite and/or origin checks reliably block them.

Recommended fix:

Add centralized protection for non-GET app routes:

- Validate `Origin` or `Referer` against `APP_URL`.
- Keep session cookies `HttpOnly`, `Secure` in HTTPS production, and `SameSite=Lax` or stricter.
- Consider adding a CSRF token for sensitive forms/actions.

### 8. Business invariants depend on app checks without transactions

Severity: Medium-High

Rules like "one pending request per student", "one active assignment per student", and "topic can only be claimed once" are checked in application code before writes.

Impact:

Concurrent requests can race between the check and the write, creating duplicate pending requests, multiple active assignments, or inconsistent topic reservation state.

Recommended fix:

Use SQLite transactions plus conditional updates. Add unique or partial unique indexes where SQLite supports the invariant, such as one active assignment per student and one pending request per student.

### 9. SQLite foreign keys are not explicitly enabled

Severity: Medium

The schema defines foreign keys, but the database connection does not explicitly enable `PRAGMA foreign_keys = ON`.

Impact:

SQLite may not enforce referential integrity unless this pragma is enabled for the connection. That can leave orphan rows and weaken authorization assumptions based on relationships.

Recommended fix:

Enable foreign keys immediately after opening the SQLite connection.

### 10. No security response headers are configured

Severity: Medium

The app does not show centralized security headers such as:

- `Content-Security-Policy`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options` or CSP `frame-ancestors`
- `Referrer-Policy`
- `Permissions-Policy`

Impact:

Security headers provide defense in depth against XSS, clickjacking, MIME sniffing, and unwanted browser feature access.

Recommended fix:

Add a global response hook/middleware for security headers. Start with a conservative CSP compatible with the current plain HTML/JS structure, then tighten it as inline scripts are moved into external files.

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

Better Auth may rate-limit some auth endpoints internally, but app-owned endpoints do not show rate limits. Login and registration behavior should also be verified explicitly.

Impact:

Brute-force attempts, spam registrations, proposal spam, notification abuse, and repeated mutation calls are easier without rate limits.

Recommended fix:

Add rate limiting for auth-adjacent actions and expensive or abuse-prone app routes. Use per-IP and, where authenticated, per-user limits.

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

Goal:

Reduce misuse once core access controls are solid.

Work:

- Add rate limits for login, registration, reset email, proposal submission, and mutation-heavy routes.
- Revisit professor registration policy.
- Consider admin/secretary approval for professor activation.
- Add audit logging for sensitive actions.

Expected risk:

Moderate. Some product decisions are involved, especially professor onboarding.

## Implementation Strategy

The safest first implementation batch is Phase 1 only.

Phase 1 addresses the two highest-impact confirmed runtime findings:

- Protected pages are served before authorization.
- Source files are publicly accessible.

It is large enough to materially improve security, but still focused enough to debug if routing or static assets break. After that, Phase 2 is a good separate follow-up because it changes repository/runtime hygiene rather than browser behavior.
