# Project: UAB Thesis/Master Project Management
**Target Institution:** Universitatea "1 Decembrie 1918" din Alba Iulia (UAB)

## Tech Stack
* **Backend:** Bun, Elysia, SQLite
* **Auth:** better-auth
* **Email:** Nodemailer (SMTP for verification and password reset links)
* **Frontend:** Plain HTML + Vanilla JS (no frontend frameworks)
* **Styling:** Tailwind CSS v3, compiled locally

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
  * Formula: `CurrentYear >= StartYear + (ProgramDuration - 1)`
  * `StartYear` is extracted from the `[year]` part of the email.
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
* Shared demo/app styling is in `src/css/site.input.css` and generated to `src/css/site.css`; auth-only styling remains in `src/css/auth.input.css` and `src/css/auth.css`.
* Topbar logout buttons use `src/js/top-actions.js`, which calls `POST /logout` and redirects to `login.html`.

## Profile Data
* `GET /profile` returns the logged-in user's real profile data. `PUT /profile` currently saves only `name` and `bio`.
* `users.bio` stores profile bio text. Initial bio is empty.
* Student profile displays `name`, `bio`, account email/Teams email, and faculty/specialization inferred from `users.facultyId` and `users.specializationId`.
* Professor profile displays `name`, `bio`, account email/Teams email, faculty access as bullet points, and specialization cards from database assignments.

## Professor Specializations
* Professors use a many-to-many table: `professor_specializations(professor_id, specialization_id)`.
* Faculty access for professors is inferred through each specialization's `faculty_id`.
* Seed data includes one professor assigned only to `Informatica`, and one professor assigned to `Informatica`, `Informatica EN`, and `Marketing`.

## Known Local Issues / Lessons

* `@better-fetch/fetch` sandbox issue:
  * Bun sometimes failed to import `@better-fetch/fetch` inside the Codex sandbox with an `EPERM`-style permission issue.
  * The package itself was fine.
  * Running the same Bun command with escalated permissions worked.
  * If this appears again, retry the same Bun command outside the sandbox or with Codex approval.
  * In Codex/agent sandbox sessions on Windows, Bun process launch can fail even when it works in VS Code. If CSS must be rebuilt and `bun run build:css` fails, running Tailwind through Node is an acceptable local fallback.

* SQLite connection locks:
  * SQLite writes can fail when DB Browser or another app holds `sqlite.db` open.
  * Close the external connection before seed/migration/server write actions.

## Development Guidelines
* Do not use React, Vue, or other frontend frameworks. Return standard HTML/JS.
* Use Tailwind utility classes for styling new or updated frontend screens.
* Tailwind source CSS lives in `src/css/*.input.css`; generated browser CSS lives beside it, e.g. `src/css/auth.css`.
* Do not hand-edit generated CSS unless intentionally debugging output. Regenerate with `bun run build:css`; use `bun run dev:css` while actively editing styles.
* Avoid Tailwind CDN in production pages.
* Rely on `better-auth` for session management and standard auth flows, extending it only where the custom UAB email parsing requires it.
* Do not use Romanian special characters in code, configuration, hardcoded mappings, database seed data, or documentation unless explicitly needed for visible UI/design text.
