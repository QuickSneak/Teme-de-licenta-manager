# Project: UAB Thesis/Master Project Management
**Target Institution:** Universitatea "1 Decembrie 1918" din Alba Iulia (UAB)

## Tech Stack
* **Backend:** Bun, Elysia, SQLite
* **Auth:** better-auth
* **Email:** Nodemailer (SMTP for verification and password reset links)
* **Frontend:** Plain HTML + Vanilla JS (no frontend frameworks)

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

## Development Guidelines
* Do not use React, Vue, or other frontend frameworks. Return standard HTML/JS.
* Rely on `better-auth` for session management and standard auth flows, extending it only where the custom UAB email parsing requires it.
* Do not use Romanian special characters in code, configuration, hardcoded mappings, database seed data, or documentation unless explicitly needed for visible UI/design text.
