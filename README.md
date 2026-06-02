# UAB Thesis Portal

Local Bun/Elysia application for UAB thesis and master project management.

## Local Setup

1. Copy `.env.example` to `.env.local`.
2. Set `BETTER_AUTH_SECRET` to a random value. Production must use a real secret with at least 32 characters.
3. Configure SMTP values if you need verification or password reset emails.
4. Run migrations/seeding as needed for your local database.
5. Start the app with:

```bash
bun run dev
```

Open `http://localhost:3000/`.

## Local Database

`sqlite.db` is local runtime state and should not be committed. It can contain password hashes, session tokens, verification records, password reset tokens, and user data.

If you need a clean local database, recreate it through the project's migration and seed workflow instead of copying a committed database file.
