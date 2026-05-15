# Project Handoff: UAB Thesis/Master Project Management

**Target Institution:** Universitatea "1 Decembrie 1918" din Alba Iulia (UAB)

This file is the working context handoff for future Codex chats. Keep it updated when major architectural or domain decisions change.

## Current Tech Stack

* **Backend:** Bun, Elysia, SQLite
* **Database ORM:** Drizzle ORM
* **Auth:** Better Auth
* **Email:** Nodemailer SMTP for verification and password reset links
* **Frontend:** Plain HTML + vanilla JS only. Do not add React, Vue, Svelte, etc.

## Current Auth State

Auth is implemented and should be treated as the stable foundation for the next phase.

* Auth config lives in `src/auth.ts`.
* Main server routes live in `src/index.ts`.
* UAB email parsing and hardcoded academic mappings live in `src/uab.ts`.
* SMTP helper lives in `src/email.ts`.
* Better Auth endpoints are mounted under `/api/auth`.
* Static pages are served from `src`.
* Real secrets belong in `.env.local`; `.env.example` is only a template.

Auth behavior:

* Students and professors can self-register.
* Secretaries are pre-created only.
* Passwords are hashed by Better Auth.
* Email verification is required before login.
* Verification links expire after 1 hour.
* Password reset links expire after 1 hour.
* Password reset revokes existing sessions.
* Remember-me is implemented through Better Auth sessions:
  * checked: persistent cookie, 30 days.
  * unchecked: browser-session cookie.
* Demo seed accounts are marked verified so local testing does not need SMTP.

## Current Database State

Existing Drizzle tables:

* `faculties`
* `specializations`
* `users`
* `sessions`
* `accounts`
* `verifications`

`users` has the Better Auth core fields plus project fields:

* `role`: `student`, `professor`, or `secretary`
* `facultyId`
* `specializationId`
* `isExtended`
* `emailVerified`

Current meaning:

* Students have `facultyId` and `specializationId`.
* Professors currently may have no assigned faculty/specialization until the next phase seeds or assigns them.
* Secretaries have `facultyId` only and manage all specializations under that faculty.

Seed files:

* `src/seed.ts` recreates verified demo users and hardcoded academic units.

## UAB Email And Academic Rules

Do not use Romanian special characters in code, config, hardcoded mappings, seed data, or docs unless explicitly needed for visible UI/design text.

Student email format:

```text
[lastname].[firstname].[specialitycode][year]@uab.ro
```

Example:

```text
onica.marius.info23@uab.ro
```

## Next Phase: Student And Professor Dashboards

The next development phase should implement the core thesis/topic selection workflow for students and professors. Secretary functionality is out of scope for this phase, except for seed data needed to simulate professor faculty/specialization assignments.

### Student Capabilities

Students:

* Can browse available thesis/master topics only for their own specialization.
* Can accept/request a topic posted by a professor.
* Can submit their own topic proposal to a professor.
* Can have only one active request at any time.
* A student-created topic proposal counts as that one active request.
* Can abandon an accepted topic at any time while the topic-selection period is open; this does not require professor approval.
* Can request a title/details change for an already accepted topic.
* Title/details change requests are valid for 3 days and require professor accept/reject.

Student categories to keep in mind:

* Bachelor students.
* Master students.

The current schema does not yet distinguish bachelor/master except indirectly through specialization/email mapping.

### Professor Capabilities

Professors:

* Have access to all specializations for the faculty/faculties they belong to.
* Can post topics for those specializations.
* Can edit topics they posted.
* Can accept or reject student requests.
* Can receive requests from multiple students for the same topic.
* When one request is accepted, topic availability must update automatically.

The next phase needs seed data assigning professors to faculties and specializations because secretary assignment UI will be handled separately by a colleague.

### Secretary Scope

Secretary implementation is not part of the next phase.

Still relevant for data modeling:

* Secretaries manage faculty-level overview data.
* Secretaries may extend student access in special cases through `users.isExtended` or a future access-window table.

## Core Request Workflow

The functional core is dynamic request management.

Request lifetime:

* A student request is valid for 72 hours.
* If the professor does not accept or reject in 72 hours, the request becomes `expired`.
* Expiration releases the student so they can submit another request.

Request constraints:

* A student may have only one active request at any time.
* Active means at least `pending` and any other status that should block a new request.
* Accepted topics are not active requests; they are assignments.

Recommended request statuses:

* `pending`
* `accepted`
* `rejected`
* `expired`
* `cancelled`

Recommended assignment/topic states:

* Topic availability should update when a request is accepted.
* A topic can be professor-posted or student-proposed.
* A topic should support at least:
  * title
  * description/details
  * professor owner
  * faculty
  * specialization
  * status/availability
  * created/updated timestamps

Expiration implementation options:

* Prefer a simple server-side expiry check for this project:
  * update expired pending requests before reading request lists.
  * update expired pending requests before creating a new request.
  * update expired pending requests before professor accepts/rejects.
* A periodic background job can be added later if needed.
* SQLite triggers are possible but less transparent for this project.

## Next Phase UI Template Note

Before implementing the student/professor dashboard functionality, the current `dashboard.html` and `professor-dashboard.html`, `js/dashboard` files will be replaced with new template code for the final page design.

Additional template pages will be added before the next implementation phase:

* `professors.html` - student page for browsing suggested projects/topics from professors in the student's specialization.
* `profile.html` - student profile page showing student account and academic information.
* `propose.html` - student page for submitting a custom topic proposal to a professor (could also probably be used as the page for professors to add to their suggested topics list with a few modifications).
* `professor-profile.html` - professor profile page.
* `professor-proposals.html` - professor page for viewing and handling current student proposals/requests.
* all of these additional files are acompanied by their own js which only serve to facilitate the overall design vision

make sure to ignore all files in the css folder as they are irrelevant and very bloated

## Suggested Next Database Additions

The next phase likely needs these tables or equivalent:

* `professorSpecializations`
  * professor-to-specialization assignment table for seeded secretary-like data.
* `topics`
  * professor-posted topics and possibly accepted student proposals.
* `topicRequests`
  * student requests for professor topics or custom topic proposals.
* `topicAssignments`
  * accepted student-topic-professor assignment.
* `topicChangeRequests`
  * student requests to change title/details after acceptance.

The user may suggest using certain tables so check wether they can fulfill all functionalities needed. If not offer alternatives.

Important modeling decision for the next chat:

* Decide whether student proposals become rows in `topics` immediately with a `proposed` status, or live only inside `topicRequests` until accepted.
* Conservative recommendation: store student proposal fields on `topicRequests` while pending, then create/attach a `topics` row only when accepted.

## Suggested Next API Surface

Keep routes simple and server-render-free.
All routes must use the existing `/me`/Better Auth session behavior and must enforce role checks.

## UI Expectations For Next Phase

Do not design a polished UI yet unless explicitly requested. Simple HTML tables/forms/buttons are enough.

## Development Guidelines

* Use `rg` for searches.
* Use Drizzle schema and typed queries; avoid ad hoc SQL unless necessary.
* Keep schema names ASCII and consistent.
* Keep frontend plain HTML/JS.
* Avoid unrelated redesign work.
* Add tests/manual verification proportional to risk.
* Before implementing the next phase, inspect current routes/schema and then design the migration/schema additions carefully.
