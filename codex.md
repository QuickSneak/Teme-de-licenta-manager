# Project: UAB Thesis/Master Project Management
**Target Institution:** Universitatea "1 Decembrie 1918" din Alba Iulia (UAB)

This file is the working project memory for future Codex sessions. Keep it current when security behavior, thesis lifecycle rules, account policy, or local development workflow changes.

## Tech Stack
* **Backend:** Bun, Elysia, SQLite
* **Database toolkit:** Drizzle ORM and Drizzle migrations
* **Auth:** better-auth email/password sessions
* **Email:** Nodemailer SMTP for verification and password reset links
* **Frontend:** Plain HTML + vanilla JavaScript, no frontend framework
* **Styling:** Tailwind CSS v3, compiled locally

## Security Baseline
* Protected HTML pages live under `src/pages` but are served through Elysia routes with server-side role checks before the page body is returned. This prevents cross-role page flashes and prevents protected page shells from being served to the wrong account type.
* Public browser assets live under `public`. Server source, DB schema, seed scripts, and protected page files must not be exposed through the static file server.
* `sqlite.db` is local runtime state and is ignored by git. It can contain password hashes, sessions, verification records, reset tokens, and user data, so do not commit it.
* `BETTER_AUTH_SECRET` may fall back to a dev-only value outside production. In `NODE_ENV=production`, startup fails unless the secret is a real non-placeholder value with at least 32 characters.
* `APP_URL` and `BETTER_AUTH_URL` should match the real deployment origin. Same-origin checks and Better Auth link generation depend on these values.
* App-owned `POST`, `PUT`, `PATCH`, and `DELETE` routes reject mismatched `Origin`/`Referer` headers. Trusted origins come from `APP_URL` and `BETTER_AUTH_URL`; local development also allows the current request origin and `http://localhost:3000`.
* Baseline security headers are applied to HTML, JSON/API responses, Better Auth responses, redirects, and static assets: CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy`.
* The CSP currently permits inline scripts and inline styles because the existing HTML pages still use them. Tighten CSP only after scripts/styles are moved to external files or nonce/hash support is added.
* SQLite foreign keys are enabled at connection startup with `PRAGMA foreign_keys = ON`.
* Thesis lifecycle invariants are backed by partial unique indexes for one pending request per student, one pending claim per topic, one active assignment per student, and one pending edit request per assignment.
* High-risk lifecycle mutations use transactions with conditional status updates so related topic/request/assignment/edit-request changes commit together.
* User-controlled frontend rendering should use DOM node creation plus `textContent`. Do not interpolate names, topic titles, descriptions, summaries, or statuses into `innerHTML`.
* Server-side text limits are enforced in `src/index.ts`: names up to 120 chars, bios up to 1000 chars, topic/proposal/edit titles up to 180 chars, and descriptions up to 4000 chars.

## Rate Limits
Rate limiting is implemented in process-local memory in `src/index.ts`. This is suitable for the current local/single-server stage, but production with multiple server instances should move counters into shared storage such as Redis or a database table.

Current limits:
* Login: 30 attempts per IP per 15 minutes.
* Failed login by email: 5 failed attempts per email per 15 minutes. A successful login clears that email's failed-login bucket.
* Registration: 5 attempts per IP per 20 minutes and 3 attempts per email per 20 minutes.
* Password reset request: 10 attempts per IP per 20 minutes and 3 attempts per email per 20 minutes.
* Verification email resend: 10 attempts per IP per 20 minutes and 3 attempts per email per 20 minutes.
* Student topic claims and custom proposals: 20 actions per authenticated user per day.
* Student assignment edit requests: 20 submissions per authenticated user per day.
* General authenticated non-GET app mutations: 300 actions per authenticated user per hour.

## Account And Auth Rules
* The app uses better-auth email/password sessions. Email verification and password reset use SMTP links. OTP flows are not part of the current implementation.
* Login requires the selected role to match the account's stored role.
* Role dashboards:
  * `student` -> `/dashboard.html`
  * `professor` -> `/professor-dashboard.html`
  * `secretary` -> `/secretary-dashboard.html`
  * `admin` -> `/admin.html`
* Protected pages redirect authenticated users back to their own dashboard when they request a page for another role.
* Admin access uses a standalone `/admin.html` page and `/admin/login`; the public login role picker intentionally does not expose an admin role.
* Opening `/admin.html` shows a blocking admin-login modal. The secretary-management UI stays hidden until `/me` confirms an authenticated admin session.
* Admin logout immediately hides the management UI and reopens the login modal before sending `POST /logout`.
* Admin accounts are seeded/managed outside public registration. The local seed admin is `admin@uab.ro` / `password123`.
* Secretary accounts are pre-created. Secretary self-registration is forbidden.
* Secretary accounts are created and edited by admins only.
* Each secretary account belongs to one faculty, and each faculty can have no more than one secretary account. This is enforced by a partial unique database index on `users.faculty_id` for `role = 'secretary'`.
* Admin-created and admin-edited secretary accounts keep `emailVerified = true`.
* Secretary password changes by admin revoke active secretary sessions.
* Secretary SMTP password reset is blocked silently at the Better Auth reset-email callback, preserving the generic "if this email exists" response.
* Professor registration is intentionally still broad for now: any `@uab.ro` address that does not match the student email pattern can register as a professor. Professor activation/approval should be revisited when the secretary page exists for assigning faculty professors and specialization access.

### Student Email Rules
* Student email format: `[lastname].[firstname].[specialitycode][year]@uab.ro` (example: `onica.marius.info23@uab.ro`).
* Only final-year students can register.
* Final-year start formula: `FinalYearStart = StartYear + (ProgramDuration - 1)`.
* `StartYear` is extracted from the `[year]` part of the email.
* If `CurrentYear > FinalYearStart`, registration is allowed.
* If `CurrentYear < FinalYearStart`, registration is blocked.
* If `CurrentYear = FinalYearStart`, registration is allowed only once the academic year has started, currently from October onward.
* The speciality code maps the student to faculty and specialization:
  * `info` -> Faculty: `Informatica si Inginerie`, Specialization: `Informatica`, duration 3 years.
  * `infoen` -> Faculty: `Informatica si Inginerie`, Specialization: `Informatica EN`, duration 3 years.
  * `mk` -> Faculty: `Stiinte Economice`, Specialization: `Marketing`, duration 3 years.

### Professor And Secretary Access
* Professors must use an `@uab.ro` address and must not match the student `[specialitycode][year]` pattern. Valid examples include dotted names like `[firstname].[lastname]@uab.ro` and compact aliases like `nbreaz@uab.ro`.
* Professors use `professor_specializations(professor_id, specialization_id)` for specialization access.
* Faculty access for professors is inferred through the faculties attached to their assigned specializations.
* Secretaries belong to one faculty through `facultyId`.
* Secretary accounts do not receive individual `specializationId` values.
* A secretary manages all specializations in their assigned faculty.
* Future secretary functionality should add and manage the professors that belong to the secretary's faculty and define exactly which specializations each professor can access.

## Current App Structure
* Server-owned HTML pages live in `src/pages`.
* Public browser assets live in `public`.
* Shared site styling source is `src/css/site.input.css`, generated to `public/css/site.css`.
* Auth-only styling source is `src/css/auth.input.css`, generated to `public/css/auth.css`.
* Topbar logout buttons use `public/js/top-actions.js`, which calls `POST /logout` and redirects to `login.html`.

## Profile Data
* `GET /profile` returns the logged-in user's real profile data.
* `PUT /profile` currently saves only `name` and `bio`.
* `users.bio` stores profile bio text. Initial bio is empty.
* Student profile displays `name`, `bio`, account email/Teams email, and faculty/specialization inferred from `users.facultyId` and `users.specializationId`.
* Professor profile displays `name`, `bio`, account email/Teams email, faculty access, and specialization cards from database assignments.

## Thesis Topic Lifecycle
The app includes the core student/professor thesis workflow: professor topic suggestions, student claims, student custom proposals, professor review, assignment creation, student edit requests, and student assignment drop.

### Tables
* `topics`
  * Stores real thesis topics only.
  * Professor-created topics are public suggestions.
  * Accepted student custom proposals become topic rows only after professor approval.
  * Key fields: `title`, `description`, `professor_id`, `specialization_id`, `origin`, `status`, `created_at`, `updated_at`.
  * `origin`: `professor` or `student_proposal`.
  * `status`: `available`, `reserved`, or `inactive`.
* `topic_requests`
  * Stores student topic claims and custom proposal requests.
  * `type`: `topic_claim` or `custom_proposal`.
  * `status`: `pending`, `accepted`, `rejected`, `expired`, or `cancelled`.
  * `student_hidden`: hides completed/expired requests from the student's dashboard without deleting the request record.
  * Custom proposals use `custom_title` and `custom_description`; they do not create a topic until accepted.
* `topic_assignments`
  * Created only after professor acceptance.
  * Stores the accepted student/professor/topic relationship.
  * Stores assignment-level `title` and `description` snapshots.
  * `status`: `active` or `abandoned`.
* `topic_change_requests`
  * Stores student title/details change requests after assignment acceptance.
  * `status`: `pending`, `accepted`, `rejected`, `expired`, or `cancelled`.
  * Pending change requests expire after 3 days.
  * Approval updates `topic_assignments.title` and `topic_assignments.description` only. It intentionally does not rewrite the original `topics` row.
* `notifications`
  * Stores persisted notifications for students and professors.
  * Key fields: `user_id`, `actor_id`, `type`, `title`, `message`, `entity_type`, `entity_id`, `topic_title`, `is_cleared`, `created_at`.
  * `is_cleared = true` hides notifications from dashboard panels without deleting them.

### Lifecycle Rules
* A student can have only one `pending` topic request at a time.
* A student can have only one `active` assignment at a time.
* A student can have only one pending edit request per active assignment.
* Pending topic requests expire after 72 hours.
* Pending edit requests expire after 3 days.
* Expiry is handled lazily server-side before relevant reads/writes.
* Professor-created topics start as `available`.
* When a student claims an available professor topic:
  * the request becomes `pending`;
  * the topic immediately becomes `reserved`;
  * competing claims are blocked.
* If the professor rejects the claim or the request expires, the professor-created topic returns to `available`.
* If the professor accepts the claim:
  * the request becomes `accepted`;
  * the topic becomes `inactive`;
  * an active assignment is created;
  * the topic no longer appears on the student professors page.
* If the professor accepts a custom proposal:
  * a `topics` row is created with `origin = 'student_proposal'` and `status = 'inactive'`;
  * an active assignment is created;
  * the request becomes `accepted`.
* Professors can edit only their own professor-origin topics while the topic is `available`.
* Professors can hard-delete only their own professor-origin topics while the topic is `available`.
* Professor topic delete also removes dependent topic request/assignment/change-request rows for that topic before deleting the topic row.
* Students can abandon their active assignment without professor confirmation.
* Abandoning a professor-origin assignment marks the assignment `abandoned` and reopens the topic as `available`.
* Abandoning a student-proposal assignment marks the assignment `abandoned`, but keeps the generated topic `inactive` as history.
* Dropping an assignment cancels pending edit requests for that assignment.
* Pending edit requests tied to non-active assignments are also cancelled during lazy cleanup.
* Students can hide completed or expired claim/proposal rows from `dashboard.html`.
* Hiding is allowed only for `accepted`, `rejected`, `expired`, or `cancelled` requests.
* Pending requests remain visible and cannot be hidden.
* Hidden rows remain in `topic_requests` for professor history and audit context.

### Student Thesis Action Limits
* A student cannot submit a topic claim or custom proposal while they have a pending topic request.
* A student cannot submit a topic claim or custom proposal while they have an active assignment.
* Topic claims must target an available professor-origin topic in the student's specialization.
* Custom proposals must target a professor who has access to the student's specialization.
* Assignment edit requests can be submitted only for the student's own active assignment.
* Assignment edit approval changes only the assignment snapshot, not the original topic suggestion.
* The daily rate limits for student proposal actions and edit-request actions are listed in the Rate Limits section.

### Notifications
* Professor notifications are created when:
  * a student submits a topic claim;
  * a student submits a custom proposal;
  * a student submits an edit request;
  * one of their students drops an active assignment.
* Student notifications are created when:
  * a professor accepts or rejects their topic claim;
  * a professor accepts or rejects their custom proposal;
  * a professor accepts or rejects their edit request;
  * a professor adds a new topic suggestion for the student's specialization.
* New topic suggestion notifications are sent only to students in the topic specialization who do not already have an active assignment.
* Dashboards use `GET /api/notifications` and hide all current notifications through `POST /api/notifications/clear`.
* Notification panels display relative time labels such as `just now`, `4m ago`, `2h ago`, and `3d ago`.

### Implemented API Surface
Student routes:
* `GET /api/student/professors`
* `GET /api/student/requests`
* `GET /api/student/assignment`
* `POST /api/student/topic-requests`
* `POST /api/student/requests/:id/dismiss`
* `POST /api/student/custom-proposals`
* `POST /api/student/assignments/:id/abandon`
* `POST /api/student/assignments/:id/change-requests`

Professor routes:
* `GET /api/professor/dashboard`
* `GET /api/professor/requests`
* `GET /api/professor/request-history`
* `POST /api/professor/topics`
* `PATCH /api/professor/topics/:id`
* `DELETE /api/professor/topics/:id`
* `POST /api/professor/requests/:id/accept`
* `POST /api/professor/requests/:id/reject`
* `GET /api/professor/change-requests`
* `POST /api/professor/change-requests/:id/accept`
* `POST /api/professor/change-requests/:id/reject`

Shared routes:
* `GET /profile`
* `PUT /profile`
* `POST /logout`
* `GET /api/notifications`
* `POST /api/notifications/clear`

Admin routes:
* `POST /admin/login`
* `GET /api/admin/secretaries`
* `POST /api/admin/secretaries`
* `PATCH /api/admin/secretaries/:id`

## UI Behavior Notes
* Topic/proposal modals should close only through their explicit close button, not by clicking outside the modal.
* Long topic/proposal modal content should remain scrollable with review buttons reachable in the viewport.
* The admin access modal on `/admin.html` is intentionally non-dismissible; only valid admin credentials should close it.
* `professors.html` loads with the desktop sidebar collapsed by default. Users can open it manually.

## Security Remediation Status
Implemented security phases:
* Phase 1: static boundary and server-side protected-page authorization.
* Phase 2: local SQLite git hygiene and production auth secret enforcement.
* Phase 3: stored-XSS hardening and server-side text length limits.
* Phase 4: same-origin checks and baseline security headers.
* Phase 5: SQLite foreign keys, partial lifecycle indexes, and transactional lifecycle mutations.
* Phase 6: app-level abuse controls and rate limiting.

Important remaining hardening options:
* Add the future secretary professor-management page and use it to tighten professor activation/specialization governance.
* Move rate-limit counters to shared storage before multi-instance production deployment.
* Tighten CSP after inline scripts/styles are moved out of HTML pages or nonce/hash CSP support is added.
* Add audit logging for sensitive lifecycle actions.
* Escape generated URLs in email templates before interpolating them into HTML attributes/text.
* Add integration tests for lifecycle races and role/page access once the project has a test runner.

## Seed Data And Reset Behavior
* Running `src/seed.ts` deletes notifications and thesis lifecycle data before recreating users and academic units.
* Manual test notifications, topics, topic requests, assignments, and change requests will be removed by seed.
* Current seeded accounts:
  * `student.test.info23@uab.ro` / `password123`
  * `student.marketing.mk23@uab.ro` / `password123`
  * `professor.info@uab.ro` / `password123`
  * `professor.multi@uab.ro` / `password123`
  * `secretary.marketing@uab.ro` / `password123`
  * `admin@uab.ro` / `password123`
* Seed data includes one professor assigned only to `Informatica`, and one professor assigned to `Informatica`, `Informatica EN`, and `Marketing`.

## Known Local Issues / Lessons
* Bun can fail inside the Codex sandbox on Better Auth / `@better-fetch/fetch` imports with an `EPERM`-style issue even when the package is fine. Retrying the same Bun command with Codex approval outside the sandbox worked.
* In Codex/agent sandbox sessions on Windows, Bun process launch can fail even when it works in VS Code. If CSS must be rebuilt and `bun run build:css` fails, running Tailwind through Node is an acceptable local fallback.
* SQLite writes can fail when DB Browser or another app holds `sqlite.db` open. Close external DB connections before seed, migration, or server write actions.
* In this workspace, `bun x tailwindcss --help`, `bun x drizzle-kit --version`, and `bun x tsc --noEmit` failed with `could not create process` / Bun bin remap errors.
* Bun recommended `bun install --force`, but this failed in Codex on the `esbuild` postinstall script with `Operation not permitted`. Do not assume `bun install --force` is a safe Codex-side repair; prefer running it manually from the user's VS Code terminal if dependency repair is needed.
* `typescript` is not currently installed as a project dependency, and there is no local `node_modules/.bin/tsc.exe`; `bun x tsc --noEmit` is not a reliable verification command until TypeScript is added.
* The plain `node` command can fail in Codex with `Access is denied`. Use the Codex workspace dependency runtime when Node is needed: call `load_workspace_dependencies`, then run the returned Node executable by absolute path.
* Tailwind fallback that worked: `NODE_EXE .\node_modules\tailwindcss\lib\cli.js -c tailwind.config.js -i src/css/site.input.css -o public/css/site.css`.
* Drizzle fallback that worked: `NODE_EXE .\node_modules\drizzle-kit\bin.cjs generate`. This may require escalation outside the sandbox because Drizzle can hit `spawn EPERM` while loading the TypeScript config.
* Starting the Bun dev server through Codex may require escalation. `bun src/index.ts` successfully started outside the sandbox; inside the sandbox it could fail to resolve Better Auth / `@better-fetch/fetch`.
* When checking whether the server starts, a timeout can mean success because the Bun process keeps serving. Verify separately with `Invoke-WebRequest http://localhost:3000/`.
* Multiple old Bun processes can keep serving stale files on `localhost:3000`. If stale content appears, inspect Bun process command lines, stop the relevant old project servers, and start one clean server.
* The browser can also show cached static HTML/JS. Use cache-busting URLs such as `professor_add_thesis.html?v=2` after frontend edits. Admin currently loads `/js/admin.js?v=2` to avoid stale modal/login behavior.
* Do not leave Codex-started Bun servers running after verification if the user wants to run the app from VS Code.
* After any Codex-started Bun verification server, inspect remaining `bun.exe` processes and stop the project server before ending the turn.

## Development Guidelines
* Do not use React, Vue, or other frontend frameworks. Return standard HTML/JS.
* Use Tailwind utility classes for styling new or updated frontend screens.
* Tailwind source CSS lives in `src/css/*.input.css`; generated browser CSS lives in `public/css`, e.g. `public/css/auth.css`.
* Do not hand-edit generated CSS unless intentionally debugging output. Regenerate with `bun run build:css`; use `bun run dev:css` while actively editing styles.
* Avoid Tailwind CDN in production pages.
* Rely on `better-auth` for session management and standard auth flows, extending it only where the custom UAB email parsing requires it.
* Do not use Romanian special characters in code, configuration, hardcoded mappings, database seed data, or documentation unless explicitly needed for visible UI/design text.
