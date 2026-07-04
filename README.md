# UAB Thesis Portal

Local Bun/Elysia application for UAB thesis and master project management.

## Local Setup

1. Copy `.env.example` to `.env.local` with correct values for the smtp server.
2. Set `BETTER_AUTH_SECRET` to a random value. Production must use a real secret with at least 32 characters.
3. Set `APP_URL` and `BETTER_AUTH_URL` to the origin users actually visit. These values are used by auth links and same-origin checks.
4. Run migrations/seeding as needed for your local database. The migration set includes partial unique indexes for thesis lifecycle integrity.
5. Start the app with:

```bash
bun run dev
```

Open `http://localhost:3000/`.

## Project Overview

UAB Thesis Portal is a local web application for managing bachelor thesis and master project coordination at Universitatea "1 Decembrie 1918" din Alba Iulia. It covers the main workflow between students, professors, secretaries, and admins: account access, role-specific dashboards, professor topic proposals, student topic requests, custom proposals, assignment management, profile data, and notifications.

The app is built as a Bun/Elysia server with SQLite as the local database. Drizzle ORM defines the schema and migrations, while Better Auth handles email/password authentication, sessions, email verification, and password reset flows. The frontend is intentionally simple: server-routed HTML pages, vanilla JavaScript in `public/js`, and Tailwind CSS compiled from `src/css` into `public/css`.

### Main Roles

- **Students** register with a UAB student email pattern that maps them to a faculty and specialization. They can browse professors/topics for their specialization, request available topics, submit custom proposals, manage an accepted assignment, and receive notifications.
- **Professors** use UAB staff-style email addresses. They can create topic suggestions, review student claims and custom proposals, handle assignment edit requests, and see request history.
- **Secretaries** are faculty-level accounts managed by admins. A secretary belongs to one faculty and can access faculty-specific dashboard/statistics areas.
- **Admins** use a separate admin login flow for managing secretary accounts.

### Thesis Workflow

Professor-created topics start as available suggestions. When a student claims one, the topic is reserved while the request is pending. If accepted, the request becomes an active assignment and the topic becomes inactive; if rejected or expired, the topic becomes available again. Students can also submit custom proposals to professors who cover their specialization. Accepted custom proposals create an assignment and store the proposal as an inactive topic record.

The database enforces important lifecycle rules with partial unique indexes, including one pending topic request per student, one pending claim per topic, one active assignment per student, and one pending edit request per assignment. Server-side transactions keep request, topic, assignment, and notification changes consistent.

### Project Structure

- `src/index.ts` contains the Elysia server, route handlers, auth checks, security headers, rate limits, and thesis lifecycle logic.
- `src/db/schema.ts` defines the Drizzle database schema.
- `drizzle/` contains generated migration files.
- `src/pages/` contains protected and public HTML pages served by the backend.
- `public/js/` contains browser-side JavaScript for dashboards, auth screens, profiles, admin pages, and notifications.
- `src/css/*.input.css` contains Tailwind input files; generated CSS is written to `public/css/`.
- `src/seed.ts` resets local data and recreates demo accounts and academic units.

### Local Data And Seed Accounts

The local SQLite database is `sqlite.db`. It is runtime state and can contain password hashes, sessions, verification tokens, reset tokens, and test data, so it should not be committed with real data.

Running `bun run src/seed.ts` clears existing lifecycle data and recreates demo users plus academic faculty/specialization records. The current seed is accounts-only and does not create thesis topics.

Seeded demo accounts use password `password123`:

- `student.test.info23@uab.ro`
- `student.marketing.mk23@uab.ro`
- `professor.info@uab.ro`
- `professor.multi@uab.ro`
- `secretary.info@uab.ro`
- `secretary.marketing@uab.ro`
- `admin@uab.ro`

### Security And Development Notes

Protected pages are served through backend role checks instead of being exposed directly as static files. Static assets live under `public`, while server code, page templates, schema files, and seed scripts stay outside the static boundary. The app also applies baseline security headers, same-origin checks for state-changing routes, server-side text limits, SQLite foreign keys, and in-memory rate limits for local/single-server development.

Before production use, configure real `APP_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, and SMTP credentials in `.env.local` or the deployment environment. Production should use a strong auth secret with at least 32 characters, real SMTP settings for auth emails, and shared storage for rate limits if the app runs on more than one server instance.
