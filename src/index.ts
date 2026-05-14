import { Elysia, t, type Context } from 'elysia';
import { staticPlugin } from '@elysiajs/static';
import { eq } from 'drizzle-orm';
import { auth } from './auth';
import { db } from './db';
import { faculties, specializations, users } from './db/schema';
import {
  dashboardByRole,
  ensureAcademicUnit,
  isUserRole,
  validateProfessorEmail,
  validateStudentEmail,
  type UserRole
} from './uab';

type AuthUser = typeof users.$inferSelect;

function jsonResponse(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), { ...init, headers });
}

function withAuthHeaders(body: unknown, headers: Headers, status = 200) {
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), { status, headers });
}

function betterAuthView(context: Context) {
  if (context.request.method !== 'GET' && context.request.method !== 'POST') {
    return new Response(null, { status: 405 });
  }

  return auth.handler(context.request);
}

async function getCurrentUser(headers: Headers) {
  const session = await auth.api.getSession({ headers });
  if (!session?.user?.id) return null;

  return db.select().from(users).where(eq(users.id, session.user.id)).get();
}

async function buildMeResponse(user: AuthUser) {
  const faculty = user.facultyId
    ? await db.select().from(faculties).where(eq(faculties.id, user.facultyId)).get()
    : null;

  const specialization = user.specializationId
    ? await db.select().from(specializations).where(eq(specializations.id, user.specializationId)).get()
    : null;

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      faculty: faculty?.name ?? null,
      specialty: specialization?.name ?? null
    },
    redirect: isUserRole(user.role) ? dashboardByRole[user.role] : '/login.html'
  };
}

function normalizeApiError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return 'Authentication failed.';
}

function getApiErrorCode(error: unknown) {
  if (typeof error !== 'object' || error === null || !('body' in error)) return null;
  const body = (error as { body?: { code?: unknown } }).body;
  return typeof body?.code === 'string' ? body.code : null;
}

new Elysia()
  .onRequest(({ request }) => {
    if (new URL(request.url).pathname.startsWith('/api/auth/')) {
      return auth.handler(request);
    }
  })
  .all('/api/auth/verify-email', betterAuthView)
  .all('/api/auth/reset-password/:token', betterAuthView)
  .all('/api/auth/reset-password', betterAuthView)
  .all('/api/auth/request-password-reset', betterAuthView)
  .all('/api/auth/send-verification-email', betterAuthView)
  .all('/api/auth/*', betterAuthView)
  .use(staticPlugin({ assets: 'src', prefix: '' }))
  .get('/', () => Bun.file('src/login.html'))
  .post(
    '/login',
    async ({ body, request }) => {
      const email = body.email.trim().toLowerCase();
      const role = body.role;

      if (!isUserRole(role)) {
        return jsonResponse({ error: 'Invalid role.' }, { status: 400 });
      }

      const user = await db.select().from(users).where(eq(users.email, email)).get();
      if (!user || user.role !== role) {
        return jsonResponse({ error: 'Invalid email, password, or role.' }, { status: 401 });
      }

      try {
        const result = await auth.api.signInEmail({
          body: {
            email,
            password: body.password,
            rememberMe: body.rememberMe ?? true
          },
          headers: request.headers,
          returnHeaders: true
        });

        return withAuthHeaders({ redirect: dashboardByRole[role] }, result.headers);
      } catch (error) {
        if (getApiErrorCode(error) === 'EMAIL_NOT_VERIFIED') {
          return jsonResponse(
            {
              error: 'Email is not verified. Check your inbox for a verification link.',
              redirect: `/verify-email.html?email=${encodeURIComponent(email)}`
            },
            { status: 403 }
          );
        }

        return jsonResponse({ error: 'Invalid email, password, or role.' }, { status: 401 });
      }
    },
    {
      body: t.Object({
        email: t.String(),
        password: t.String(),
        role: t.String(),
        rememberMe: t.Optional(t.Boolean())
      })
    }
  )
  .post(
    '/register',
    async ({ body, request }) => {
      const role = body.role as UserRole;
      const password = body.password.trim();

      if (role === 'secretary') {
        return jsonResponse({ error: 'Secretary accounts are pre-created.' }, { status: 403 });
      }

      if (role !== 'student' && role !== 'professor') {
        return jsonResponse({ error: 'Invalid role.' }, { status: 400 });
      }

      if (password !== body.confirmPassword.trim()) {
        return jsonResponse({ error: 'Passwords do not match.' }, { status: 400 });
      }

      let normalizedEmail: string;
      let facultyId: number | undefined;
      let specializationId: number | undefined;

      if (role === 'student') {
        const validation = validateStudentEmail(body.email);
        if (!validation.ok) return jsonResponse({ error: validation.error }, { status: 400 });

        normalizedEmail = validation.parsed.email;
        const academicUnit = await ensureAcademicUnit(validation.parsed.mapping);
        facultyId = academicUnit.faculty.id;
        specializationId = academicUnit.specialization.id;
      } else {
        const validation = validateProfessorEmail(body.email);
        if (!validation.ok) return jsonResponse({ error: validation.error }, { status: 400 });

        normalizedEmail = validation.email;
      }

      try {
        const result = await auth.api.signUpEmail({
          body: {
            email: normalizedEmail,
            password,
            name: body.name.trim(),
            role,
            facultyId,
            specializationId,
            isExtended: false,
            callbackURL: '/login.html?verified=1'
          },
          headers: request.headers,
          returnHeaders: true
        });

        return withAuthHeaders(
          { message: 'Account created. Check your email to verify your account before logging in.' },
          result.headers
        );
      } catch (error) {
        return jsonResponse({ error: normalizeApiError(error) }, { status: 400 });
      }
    },
    {
      body: t.Object({
        name: t.String(),
        email: t.String(),
        password: t.String(),
        confirmPassword: t.String(),
        role: t.String()
      })
    }
  )
  .post('/logout', async ({ request }) => {
    const result = await auth.api.signOut({
      headers: request.headers,
      returnHeaders: true
    });

    return withAuthHeaders({ redirect: '/login.html' }, result.headers);
  })
  .get('/me', async ({ request }) => {
    const user = await getCurrentUser(request.headers);
    if (!user) return jsonResponse({ error: 'Not authenticated.' }, { status: 401 });

    return buildMeResponse(user);
  })
  .listen(3000);
