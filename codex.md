# Project: UAB Thesis/Master Project Management
**Target Institution:** Universitatea "1 Decembrie 1918" din Alba Iulia (UAB)

## Tech Stack
* **Backend:** Bun, Elysia, SQLite
* **Auth:** better-auth
* **Email:** Nodemailer (SMTP for OTPs and Resets)
* **Frontend:** Plain HTML + Vanilla JS (No frontend frameworks)

## Current Focus
Building a fully functional authentication system featuring:
1. Hashed passwords.
2. Email validation via OTP (6-digit code sent to email).
3. Password reset via email OTP.

## Business Logic & Authentication Rules

### 1. Account Types & Email Structures
* **Students:** `[lastname].[firstname].[specialitycode][year]@uab.ro` (e.g., `onica.marius.info23@uab.ro`)
* **Professors:** Typically `[firstname].[lastname]@uab.ro`. Must end in `@uab.ro` but MUST NOT contain the student `[specialitycode][year]` pattern.
* **Secretaries:** Pre-created by the admin, assigned per faculty. No self-registration.

### 2. Student Validation Logic
* **Eligibility:** Only students in their final year can register. 
  * Formula: `CurrentYear >= StartYear + (ProgramDuration - 1)`
  * *Note: `StartYear` is extracted from the `[year]` part of the email.*
* **Routing/Mapping:** The `[specialitycode]` from the email maps the student to their Faculty and Specialization.
  * This mapping MUST be hardcoded in the application configuration.
  * *Examples:* 
    * `info` -> Faculty: Informatică și Inginerie, Specialization: Informatică (3 years)
    * `infoen` -> Faculty: Informatică și Inginerie, Specialization: Informatică EN (3 years)
    * `mk` -> Faculty: Științe Economice, Specialization: Marketing

## Development Guidelines
* Do not use React, Vue, or other frontend frameworks. Return standard HTML/JS.
* Rely on `better-auth` for session management and standard auth flows, extending it only where the custom UAB email parsing requires it.