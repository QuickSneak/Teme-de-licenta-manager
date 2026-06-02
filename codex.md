# Project: UAB Thesis/Master Project Management
**Target Institution:** Universitatea "1 Decembrie 1918" din Alba Iulia (UAB)

## Tech Stack
* **Backend:** Bun, Elysia, SQLite
* **Auth:** better-auth
* **Email:** Nodemailer (SMTP for verification and password reset links)
* **Frontend:** Plain HTML + Vanilla JS (no frontend frameworks)
* **Styling:** Tailwind CSS v3, compiled locally

## Security Baseline
* `sqlite.db` is local runtime state and is ignored by git. It should not be committed because it can contain password hashes, sessions, verification records, reset tokens, and user data.
* `BETTER_AUTH_SECRET` may fall back to a dev-only value outside production. In `NODE_ENV=production`, startup fails unless the secret is a real non-placeholder value with at least 32 characters.
* App-owned `POST`, `PUT`, `PATCH`, and `DELETE` routes reject mismatched `Origin`/`Referer` headers. Trusted origins come from `APP_URL` and `BETTER_AUTH_URL`; local development also allows the current request origin and `http://localhost:3000`.
* Baseline security headers are applied to HTML, JSON/API responses, Better Auth responses, redirects, and static assets. The CSP currently permits inline scripts/styles because the HTML pages still use inline scripts/styles.
* SQLite foreign keys are enabled at connection startup. Lifecycle invariants are backed by partial unique indexes for one pending request per student, one pending claim per topic, one active assignment per student, and one pending edit request per assignment.
* High-risk lifecycle mutations use transactions with conditional status updates so related topic/request/assignment changes commit together.
* App-level rate limiting is process-local memory in `src/index.ts`. Current limits: login `30/IP/15min` and `5 failed/email/15min`; registration `5/IP/20min` and `3/email/20min`; password reset `10/IP/20min` and `3/email/20min`; verification resend `10/IP/20min` and `3/email/20min`; student topic/custom proposal actions `20/user/day`; student edit requests `20/user/day`; general authenticated mutations `300/user/hour`.
* User-controlled frontend rendering should use DOM node creation plus `textContent`. Do not interpolate names, topic titles, descriptions, summaries, or statuses into `innerHTML`.
* Server-side text limits are enforced in `src/index.ts`: names up to 120 chars, bios up to 1000 chars, topic/proposal/edit titles up to 180 chars, and descriptions up to 4000 chars.

## Current Auth Focus
Building functional email/password authentication featuring:
1. Hashed passwords.
2. Better Auth sessions.
3. Role-based redirects and dashboard access.

Email verification and password reset use SMTP email links. OTP-based flows are not part of the current implementation.

## Business Logic & Authentication Rules

### 1. Account Types & Email Structures
* **Students:** `[lastname].[firstname].[specialitycode][year]@uab.ro` (example: `onica.marius.info23@uab.ro`)
* **Professors:** Must end in `@uab.ro` and must not match the student `[specialitycode][year]` pattern. Valid formats include dotted names like `[firstname].[lastname]@uab.ro` and compact aliases like `nbreaz@uab.ro`.
* **Secretaries:** Pre-created by the admin, assigned per faculty. No self-registration.

### 2. Student Validation Logic
* **Eligibility:** Only students in their final year can register.
  * Final-year start formula: `FinalYearStart = StartYear + (ProgramDuration - 1)`
  * `StartYear` is extracted from the `[year]` part of the email.
  * If `CurrentYear > FinalYearStart`, registration is allowed.
  * If `CurrentYear < FinalYearStart`, registration is blocked.
  * If `CurrentYear = FinalYearStart`, registration is allowed only once the academic year has started, currently from October onward. This is intended to cover the first-semester thesis selection window.
* **Routing/Mapping:** The `[specialitycode]` from the email maps the student to their faculty and specialization.
  * This mapping must be hardcoded in the application configuration.
  * `info` -> Faculty: `Informatica si Inginerie`, Specialization: `Informatica` (3 years)
  * `infoen` -> Faculty: `Informatica si Inginerie`, Specialization: `Informatica EN` (3 years)
  * `mk` -> Faculty: `Stiinte Economice`, Specialization: `Marketing` (3 years)

### 3. Secretary Faculty Logic
* Each secretary account belongs to one faculty through `facultyId`.
* Secretary accounts do not receive individual `specializationId` values.
* A secretary manages all specializations that are part of their assigned faculty.

## Current App Structure
* Server-owned HTML pages live in `src/pages` and are returned through Elysia routes. Protected pages are checked server-side before HTML is served.
* Public browser assets live in `public`. Shared demo/app styling is in `src/css/site.input.css` and generated to `public/css/site.css`; auth-only styling is in `src/css/auth.input.css` and generated to `public/css/auth.css`.
* Topbar logout buttons use `public/js/top-actions.js`, which calls `POST /logout` and redirects to `login.html`.

## Profile Data
* `GET /profile` returns the logged-in user's real profile data. `PUT /profile` currently saves only `name` and `bio`.
* `users.bio` stores profile bio text. Initial bio is empty.
* Student profile displays `name`, `bio`, account email/Teams email, and faculty/specialization inferred from `users.facultyId` and `users.specializationId`.
* Professor profile displays `name`, `bio`, account email/Teams email, faculty access as bullet points, and specialization cards from database assignments.

## Professor Specializations
* Professors use a many-to-many table: `professor_specializations(professor_id, specialization_id)`.
* Faculty access for professors is inferred through each specialization's `faculty_id`.
* Seed data includes one professor assigned only to `Informatica`, and one professor assigned to `Informatica`, `Informatica EN`, and `Marketing`.

## Thesis Topic Lifecycle

The app now includes the core student/professor thesis workflow.

### Tables
* `topics`
  * Stores real thesis topics only.
  * Professor-created topics are public suggestions.
  * Accepted student custom proposals become topic rows only after professor approval.
  * Key fields: `title`, `description`, `professor_id`, `specialization_id`, `origin`, `status`, `created_at`, `updated_at`.
  * `origin`: `professor` or `student_proposal`.
  * `status`: `available`, `reserved`, or `inactive`.
* `topic_requests`
  * Stores student requests.
  * Supports claims on professor topics and custom student proposals.
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
  * Pending change requests expire after 3 days.
  * Approval updates `topic_assignments.title` and `topic_assignments.description` only. It intentionally does not rewrite the original `topics` row.
* `notifications`
  * Stores persisted notifications for students and professors.
  * Key fields: `user_id`, `actor_id`, `type`, `title`, `message`, `entity_type`, `entity_id`, `topic_title`, `is_cleared`, `created_at`.
  * `is_cleared = true` hides notifications from dashboard panels without deleting them.

### Rules
* A student can have only one `pending` topic request at a time.
* A student can have only one `active` assignment at a time.
* Pending topic requests expire after 72 hours.
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
  * Delete also removes dependent topic request/assignment/change-request rows for that topic before deleting the topic row.
* Students can abandon their active assignment without professor confirmation.
* Abandoning a professor-origin assignment marks the assignment `abandoned` and reopens the topic as `available`.
* Abandoning a student-proposal assignment marks the assignment `abandoned`, but keeps the generated topic `inactive` as history.
* Students can request title/description edits for active assignments.
  * A student can have only one pending change request per active assignment.
  * Professors review edit requests on `professor-proposals.html` alongside topic claims and custom proposals.
  * Edit-request review modals compare the current assignment title/description with the requested version.
* `professor-proposals.html` history shows accepted/rejected topic claims, custom proposals, and edit requests.
  * History sections are separated into approved/rejected lists and sorted newest to oldest by `updated_at`.
  * Each list shows three rows by default and expands with the footer button when more records exist.
* Students can hide completed or expired claim/proposal rows from `dashboard.html`.
  * Hiding is allowed only for `accepted`, `rejected`, `expired`, or `cancelled` requests.
  * Pending requests remain visible and cannot be hidden.
  * Hidden rows remain in `topic_requests` for professor history and audit context.
* `professors.html` loads with the desktop sidebar collapsed by default. Users can open it manually.

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
* `GET /api/notifications`
* `POST /api/notifications/clear`

## Known Local Issues / Lessons

* `@better-fetch/fetch` sandbox issue:
  * Bun sometimes failed to import `@better-fetch/fetch` inside the Codex sandbox with an `EPERM`-style permission issue.
  * The package itself was fine.
  * Running the same Bun command with escalated permissions worked.
  * If this appears again, retry the same Bun command outside the sandbox or with Codex approval.
  * Better Auth imports can surface the same underlying issue because Better Auth telemetry imports `@better-fetch/fetch`.
  * In Codex/agent sandbox sessions on Windows, Bun process launch can fail even when it works in VS Code. If CSS must be rebuilt and `bun run build:css` fails, running Tailwind through Node is an acceptable local fallback.

* SQLite connection locks:
  * SQLite writes can fail when DB Browser or another app holds `sqlite.db` open.
  * Close the external connection before seed/migration/server write actions.

* Bun local binary remap failures:
  * In this workspace, `bun x tailwindcss --help`, `bun x drizzle-kit --version`, and `bun x tsc --noEmit` failed with `could not create process` / Bun bin remap errors.
  * Bun recommended `bun install --force`, but this also failed in Codex on the `esbuild` postinstall script with `Operation not permitted`.
  * Do not assume `bun install --force` is a safe Codex-side repair. Prefer running it manually from the user's VS Code terminal if a dependency repair is needed.
  * `typescript` is not currently installed as a project dependency, and there is no local `node_modules/.bin/tsc.exe`; `bun x tsc --noEmit` is not a reliable verification command until TypeScript is added.

* Bundled Node fallback:
  * The plain `node` command can fail in Codex with `Access is denied`.
  * Use the Codex workspace dependency runtime when Node is needed: call `load_workspace_dependencies`, then run the returned Node executable by absolute path.
  * Tailwind fallback that worked:
    * `NODE_EXE .\node_modules\tailwindcss\lib\cli.js -c tailwind.config.js -i src/css/site.input.css -o public/css/site.css`
  * Drizzle fallback that worked:
    * `NODE_EXE .\node_modules\drizzle-kit\bin.cjs generate`
    * This may require escalation outside the sandbox because Drizzle can hit `spawn EPERM` while loading the TypeScript config.

* Bun dev server and browser verification:
  * Starting the server through Codex may require escalation. `bun src/index.ts` successfully started outside the sandbox; inside the sandbox it could fail to resolve Better Auth / `@better-fetch/fetch`.
  * When checking whether the server starts, a timeout can mean success because the Bun process keeps serving. Verify separately with `Invoke-WebRequest http://localhost:3000/`.
  * Multiple old Bun processes can keep serving stale files on `localhost:3000`.
  * Before browser testing changed HTML, check `Get-Process bun`. If stale content appears, inspect process command lines with escalated `Get-CimInstance Win32_Process -Filter "name = 'bun.exe'" | Select-Object ProcessId,CommandLine`, stop the relevant old project servers, and start one clean server.
  * The browser can also show cached static HTML. Use cache-busting URLs such as `professor_add_thesis.html?v=2` after frontend edits.
  * Do not leave Codex-started Bun servers running after verification if the user wants to run the app from VS Code.

* Seed data reset behavior:
  * Running `src/seed.ts` deletes thesis lifecycle data before recreating users and academic units.
  * Manual test topics, topic requests, assignments, and change requests will be removed by seed.
  * Current seeded student accounts include:
    * `student.test.info23@uab.ro` / `password123`
    * `student.marketing.mk23@uab.ro` / `password123`

## Development Guidelines
* Do not use React, Vue, or other frontend frameworks. Return standard HTML/JS.
* Use Tailwind utility classes for styling new or updated frontend screens.
* Tailwind source CSS lives in `src/css/*.input.css`; generated browser CSS lives in `public/css`, e.g. `public/css/auth.css`.
* Do not hand-edit generated CSS unless intentionally debugging output. Regenerate with `bun run build:css`; use `bun run dev:css` while actively editing styles.
* Avoid Tailwind CDN in production pages.
* Rely on `better-auth` for session management and standard auth flows, extending it only where the custom UAB email parsing requires it.
* Do not use Romanian special characters in code, configuration, hardcoded mappings, database seed data, or documentation unless explicitly needed for visible UI/design text.
