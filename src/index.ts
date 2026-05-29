import { Elysia, t, type Context } from 'elysia';
import { staticPlugin } from '@elysiajs/static';
import { and, eq, inArray, lt, or } from 'drizzle-orm';
import { auth } from './auth';
import { db } from './db';
import {
  faculties,
  professorSpecializations,
  specializations,
  topicAssignments,
  topicChangeRequests,
  topicRequests,
  topics,
  users
} from './db/schema';
import {
  dashboardByRole,
  ensureAcademicUnit,
  isUserRole,
  validateProfessorEmail,
  validateStudentEmail,
  type UserRole
} from './uab';

type AuthUser = typeof users.$inferSelect;
type UserWithRole = AuthUser & { role: UserRole };

const requestLifetimeMs = 72 * 60 * 60 * 1000;
const changeRequestLifetimeMs = 3 * 24 * 60 * 60 * 1000;

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

async function requireRole(headers: Headers, role: UserRole) {
  const user = await getCurrentUser(headers);
  if (!user) return { response: jsonResponse({ error: 'Not authenticated.' }, { status: 401 }) };
  if (user.role !== role) return { response: jsonResponse({ error: 'Forbidden.' }, { status: 403 }) };
  return { user: user as UserWithRole };
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

async function getProfessorAcademicUnits(professorId: string) {
  return db
    .select({
      specializationId: specializations.id,
      specialization: specializations.name,
      facultyId: faculties.id,
      faculty: faculties.name
    })
    .from(professorSpecializations)
    .innerJoin(specializations, eq(professorSpecializations.specializationId, specializations.id))
    .innerJoin(faculties, eq(specializations.facultyId, faculties.id))
    .where(eq(professorSpecializations.professorId, professorId));
}

function nowDate() {
  return new Date();
}

function addMs(date: Date, ms: number) {
  return new Date(date.getTime() + ms);
}

function trimRequired(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed;
}

function summarizeWords(text: string, limit = 20) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= limit) return text.trim();
  return `${words.slice(0, limit).join(' ')}...`;
}

async function hasProfessorSpecialization(professorId: string, specializationId: number) {
  const assignment = await db
    .select()
    .from(professorSpecializations)
    .where(
      and(
        eq(professorSpecializations.professorId, professorId),
        eq(professorSpecializations.specializationId, specializationId)
      )
    )
    .get();

  return Boolean(assignment);
}

async function expirePendingTopicRequests() {
  const now = nowDate();
  const expired = await db
    .select()
    .from(topicRequests)
    .where(and(eq(topicRequests.status, 'pending'), lt(topicRequests.expiresAt, now)));

  for (const request of expired) {
    await db.update(topicRequests).set({ status: 'expired', updatedAt: now }).where(eq(topicRequests.id, request.id));

    if (request.type === 'topic_claim' && request.topicId) {
      const topic = await db.select().from(topics).where(eq(topics.id, request.topicId)).get();
      if (topic?.status === 'reserved') {
        await db.update(topics).set({ status: 'available', updatedAt: now }).where(eq(topics.id, topic.id));
      }
    }
  }
}

async function expirePendingChangeRequests() {
  const now = nowDate();
  await db
    .update(topicChangeRequests)
    .set({ status: 'expired', updatedAt: now })
    .where(and(eq(topicChangeRequests.status, 'pending'), lt(topicChangeRequests.expiresAt, now)));
}

async function expirePendingLifecycleItems() {
  await expirePendingTopicRequests();
  await expirePendingChangeRequests();
}

async function studentHasPendingRequest(studentId: string) {
  await expirePendingTopicRequests();
  const pending = await db
    .select()
    .from(topicRequests)
    .where(and(eq(topicRequests.studentId, studentId), eq(topicRequests.status, 'pending')))
    .get();
  return Boolean(pending);
}

async function studentHasActiveAssignment(studentId: string) {
  const assignment = await db
    .select()
    .from(topicAssignments)
    .where(and(eq(topicAssignments.studentId, studentId), eq(topicAssignments.status, 'active')))
    .get();
  return Boolean(assignment);
}

async function buildTopicRequestRows(whereClause: ReturnType<typeof and> | ReturnType<typeof eq>) {
  const rows = await db
    .select({
      id: topicRequests.id,
      studentId: topicRequests.studentId,
      professorId: topicRequests.professorId,
      topicId: topicRequests.topicId,
      type: topicRequests.type,
      customTitle: topicRequests.customTitle,
      customDescription: topicRequests.customDescription,
      status: topicRequests.status,
      expiresAt: topicRequests.expiresAt,
      createdAt: topicRequests.createdAt,
      updatedAt: topicRequests.updatedAt,
      studentName: users.name,
      topicTitle: topics.title,
      topicDescription: topics.description,
      topicOrigin: topics.origin,
      topicStatus: topics.status,
      professorName: users.name
    })
    .from(topicRequests)
    .leftJoin(topics, eq(topicRequests.topicId, topics.id))
    .innerJoin(users, eq(topicRequests.studentId, users.id))
    .where(whereClause);

  const professorIds = Array.from(new Set(rows.map((row) => row.professorId)));
  const professors = professorIds.length
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, professorIds))
    : [];
  const professorsById = new Map(professors.map((professor) => [professor.id, professor.name]));

  return rows.map((row) => {
    const title = row.type === 'custom_proposal' ? row.customTitle ?? '' : row.topicTitle ?? '';
    const description =
      row.type === 'custom_proposal' ? row.customDescription ?? '' : row.topicDescription ?? '';

    return {
      id: row.id,
      studentId: row.studentId,
      studentName: row.studentName,
      professorId: row.professorId,
      professorName: professorsById.get(row.professorId) ?? 'Unknown professor',
      topicId: row.topicId,
      type: row.type,
      title,
      description,
      summary: summarizeWords(description),
      status: row.status,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      topicOrigin: row.topicOrigin,
      topicStatus: row.topicStatus
    };
  });
}

async function buildProfileResponse(user: AuthUser) {
  const base = {
    id: user.id,
    email: user.email,
    name: user.name,
    bio: user.bio ?? '',
    role: user.role
  };

  if (user.role === 'professor') {
    const units = await getProfessorAcademicUnits(user.id);
    const facultiesById = new Map<number, string>();

    units.forEach((unit) => {
      facultiesById.set(unit.facultyId, unit.faculty);
    });

    return {
      user: base,
      faculties: Array.from(facultiesById, ([id, name]) => ({ id, name })),
      specializations: units.map((unit) => ({
        id: unit.specializationId,
        name: unit.specialization,
        facultyId: unit.facultyId,
        faculty: unit.faculty
      }))
    };
  }

  const faculty = user.facultyId
    ? await db.select().from(faculties).where(eq(faculties.id, user.facultyId)).get()
    : null;

  const specialization = user.specializationId
    ? await db.select().from(specializations).where(eq(specializations.id, user.specializationId)).get()
    : null;

  return {
    user: base,
    faculty: faculty ? { id: faculty.id, name: faculty.name } : null,
    specialization: specialization ? { id: specialization.id, name: specialization.name } : null
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
            bio: '',
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
          { message: 'Check email to verify account.' },
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
  .get('/profile', async ({ request }) => {
    const user = await getCurrentUser(request.headers);
    if (!user) return jsonResponse({ error: 'Not authenticated.' }, { status: 401 });

    return buildProfileResponse(user);
  })
  .put(
    '/profile',
    async ({ body, request }) => {
      const user = await getCurrentUser(request.headers);
      if (!user) return jsonResponse({ error: 'Not authenticated.' }, { status: 401 });

      const name = body.name.trim();
      const bio = body.bio.trim();

      if (!name) {
        return jsonResponse({ error: 'Full name is required.' }, { status: 400 });
      }

      await db
        .update(users)
        .set({ name, bio, updatedAt: new Date() })
        .where(eq(users.id, user.id));

      const updatedUser = await db.select().from(users).where(eq(users.id, user.id)).get();
      if (!updatedUser) return jsonResponse({ error: 'Profile could not be loaded.' }, { status: 500 });

      return buildProfileResponse(updatedUser);
    },
    {
      body: t.Object({
        name: t.String(),
      bio: t.String()
      })
    }
  )
  .get('/api/professor/dashboard', async ({ request }) => {
    const authResult = await requireRole(request.headers, 'professor');
    if ('response' in authResult) return authResult.response;

    await expirePendingLifecycleItems();
    const professor = authResult.user;
    const units = await getProfessorAcademicUnits(professor.id);
    const facultyIds = Array.from(new Set(units.map((unit) => unit.facultyId)));
    const facultyRows = facultyIds.length
      ? await db.select().from(faculties).where(inArray(faculties.id, facultyIds))
      : [];

    const topicRows = await db
      .select({
        id: topics.id,
        title: topics.title,
        description: topics.description,
        professorId: topics.professorId,
        specializationId: topics.specializationId,
        origin: topics.origin,
        status: topics.status,
        createdAt: topics.createdAt,
        updatedAt: topics.updatedAt,
        specialization: specializations.name,
        facultyId: faculties.id,
        faculty: faculties.name
      })
      .from(topics)
      .innerJoin(specializations, eq(topics.specializationId, specializations.id))
      .innerJoin(faculties, eq(specializations.facultyId, faculties.id))
      .where(eq(topics.professorId, professor.id));

    const assignmentRows = await db
      .select({
        id: topicAssignments.id,
        studentId: topicAssignments.studentId,
        professorId: topicAssignments.professorId,
        topicId: topicAssignments.topicId,
        title: topicAssignments.title,
        description: topicAssignments.description,
        status: topicAssignments.status,
        createdAt: topicAssignments.createdAt,
        studentName: users.name,
        topicOrigin: topics.origin,
        specialization: specializations.name,
        faculty: faculties.name
      })
      .from(topicAssignments)
      .innerJoin(users, eq(topicAssignments.studentId, users.id))
      .innerJoin(topics, eq(topicAssignments.topicId, topics.id))
      .innerJoin(specializations, eq(topics.specializationId, specializations.id))
      .innerJoin(faculties, eq(specializations.facultyId, faculties.id))
      .where(and(eq(topicAssignments.professorId, professor.id), eq(topicAssignments.status, 'active')));

    const pendingRequests = await db
      .select()
      .from(topicRequests)
      .where(and(eq(topicRequests.professorId, professor.id), eq(topicRequests.status, 'pending')));

    return {
      professor: { id: professor.id, name: professor.name, email: professor.email },
      faculties: facultyRows,
      specializations: units.map((unit) => ({
        id: unit.specializationId,
        name: unit.specialization,
        facultyId: unit.facultyId,
        faculty: unit.faculty
      })),
      topics: topicRows.map((topic) => ({ ...topic, summary: summarizeWords(topic.description) })),
      assignments: assignmentRows.map((assignment) => ({
        ...assignment,
        summary: summarizeWords(assignment.description)
      })),
      stats: {
        pendingRequests: pendingRequests.length,
        approvedStudents: assignmentRows.length
      }
    };
  })
  .get('/api/professor/requests', async ({ request }) => {
    const authResult = await requireRole(request.headers, 'professor');
    if ('response' in authResult) return authResult.response;

    await expirePendingLifecycleItems();
    const rows = await buildTopicRequestRows(
      and(eq(topicRequests.professorId, authResult.user.id), eq(topicRequests.status, 'pending'))
    );

    const specializationIds = Array.from(
      new Set(
        rows
          .map((row) => row.topicId)
          .filter((topicId): topicId is number => Boolean(topicId))
      )
    );
    const topicUnits = specializationIds.length
      ? await db
          .select({
            topicId: topics.id,
            specializationId: specializations.id,
            specialization: specializations.name,
            facultyId: faculties.id,
            faculty: faculties.name
          })
          .from(topics)
          .innerJoin(specializations, eq(topics.specializationId, specializations.id))
          .innerJoin(faculties, eq(specializations.facultyId, faculties.id))
          .where(inArray(topics.id, specializationIds))
      : [];
    const unitsByTopicId = new Map(topicUnits.map((unit) => [unit.topicId, unit]));

    const studentIds = Array.from(new Set(rows.map((row) => row.studentId)));
    const studentRows = studentIds.length
      ? await db
          .select({
            id: users.id,
            specializationId: users.specializationId
          })
          .from(users)
          .where(inArray(users.id, studentIds))
      : [];
    const studentSpecializationsById = new Map(studentRows.map((student) => [student.id, student.specializationId]));
    const customSpecializationIds = Array.from(
      new Set(studentRows.map((student) => student.specializationId).filter((id): id is number => Boolean(id)))
    );
    const customUnits = customSpecializationIds.length
      ? await db
          .select({
            specializationId: specializations.id,
            specialization: specializations.name,
            facultyId: faculties.id,
            faculty: faculties.name
          })
          .from(specializations)
          .innerJoin(faculties, eq(specializations.facultyId, faculties.id))
          .where(inArray(specializations.id, customSpecializationIds))
      : [];
    const customUnitsBySpecializationId = new Map(customUnits.map((unit) => [unit.specializationId, unit]));

    return {
      requests: rows.map((row) => {
        const unit =
          row.topicId !== null
            ? unitsByTopicId.get(row.topicId)
            : customUnitsBySpecializationId.get(studentSpecializationsById.get(row.studentId) ?? 0);

        return {
          ...row,
          facultyId: unit?.facultyId ?? null,
          faculty: unit?.faculty ?? null,
          specializationId: unit?.specializationId ?? null,
          specialization: unit?.specialization ?? null
        };
      })
    };
  })
  .post(
    '/api/professor/topics',
    async ({ body, request }) => {
      const authResult = await requireRole(request.headers, 'professor');
      if ('response' in authResult) return authResult.response;

      const title = trimRequired(body.title, 'Title');
      const description = trimRequired(body.description, 'Description');
      const specializationId = Number(body.specializationId);

      if (!(await hasProfessorSpecialization(authResult.user.id, specializationId))) {
        return jsonResponse({ error: 'This professor is not assigned to that specialisation.' }, { status: 403 });
      }

      const now = nowDate();
      const [created] = await db
        .insert(topics)
        .values({
          title,
          description,
          professorId: authResult.user.id,
          specializationId,
          origin: 'professor',
          status: 'available',
          createdAt: now,
          updatedAt: now
        })
        .returning();

      return jsonResponse({ topic: created }, { status: 201 });
    },
    {
      body: t.Object({
        title: t.String(),
        description: t.String(),
        specializationId: t.Number()
      })
    }
  )
  .patch(
    '/api/professor/topics/:id',
    async ({ body, params, request }) => {
      const authResult = await requireRole(request.headers, 'professor');
      if ('response' in authResult) return authResult.response;

      const topicId = Number(params.id);
      const topic = await db.select().from(topics).where(eq(topics.id, topicId)).get();
      if (!topic || topic.professorId !== authResult.user.id) {
        return jsonResponse({ error: 'Topic not found.' }, { status: 404 });
      }

      const updates: Partial<typeof topics.$inferInsert> = { updatedAt: nowDate() };
      if (body.title !== undefined) updates.title = trimRequired(body.title, 'Title');
      if (body.description !== undefined) updates.description = trimRequired(body.description, 'Description');
      if (body.status !== undefined) {
        if (!['available', 'reserved', 'inactive'].includes(body.status)) {
          return jsonResponse({ error: 'Invalid topic status.' }, { status: 400 });
        }
        updates.status = body.status;
      }
      if (body.specializationId !== undefined) {
        const specializationId = Number(body.specializationId);
        if (!(await hasProfessorSpecialization(authResult.user.id, specializationId))) {
          return jsonResponse({ error: 'This professor is not assigned to that specialisation.' }, { status: 403 });
        }
        updates.specializationId = specializationId;
      }

      const [updated] = await db.update(topics).set(updates).where(eq(topics.id, topicId)).returning();
      return { topic: updated };
    },
    {
      body: t.Object({
        title: t.Optional(t.String()),
        description: t.Optional(t.String()),
        status: t.Optional(t.String()),
        specializationId: t.Optional(t.Number())
      })
    }
  )
  .post('/api/professor/requests/:id/accept', async ({ params, request }) => {
    const authResult = await requireRole(request.headers, 'professor');
    if ('response' in authResult) return authResult.response;

    await expirePendingLifecycleItems();
    const requestId = Number(params.id);
    const topicRequest = await db.select().from(topicRequests).where(eq(topicRequests.id, requestId)).get();
    if (!topicRequest || topicRequest.professorId !== authResult.user.id) {
      return jsonResponse({ error: 'Request not found.' }, { status: 404 });
    }
    if (topicRequest.status !== 'pending') {
      return jsonResponse({ error: 'Only pending requests can be accepted.' }, { status: 400 });
    }
    if (await studentHasActiveAssignment(topicRequest.studentId)) {
      return jsonResponse({ error: 'This student already has an active assignment.' }, { status: 409 });
    }

    const now = nowDate();
    let acceptedTopic: typeof topics.$inferSelect | undefined;

    if (topicRequest.type === 'topic_claim') {
      if (!topicRequest.topicId) return jsonResponse({ error: 'Topic claim is missing a topic.' }, { status: 400 });

      const topic = await db.select().from(topics).where(eq(topics.id, topicRequest.topicId)).get();
      if (!topic || topic.professorId !== authResult.user.id) {
        return jsonResponse({ error: 'Topic not found.' }, { status: 404 });
      }
      if (topic.status !== 'reserved') {
        return jsonResponse({ error: 'Topic is not reserved by this request.' }, { status: 409 });
      }

      const [updatedTopic] = await db
        .update(topics)
        .set({ status: 'inactive', updatedAt: now })
        .where(eq(topics.id, topic.id))
        .returning();
      acceptedTopic = updatedTopic;
    } else {
      const student = await db.select().from(users).where(eq(users.id, topicRequest.studentId)).get();
      if (!student?.specializationId) {
        return jsonResponse({ error: 'Student specialisation could not be found.' }, { status: 400 });
      }
      if (!(await hasProfessorSpecialization(authResult.user.id, student.specializationId))) {
        return jsonResponse({ error: 'This professor is not assigned to the student specialisation.' }, { status: 403 });
      }

      const [createdTopic] = await db
        .insert(topics)
        .values({
          title: topicRequest.customTitle ?? '',
          description: topicRequest.customDescription ?? '',
          professorId: authResult.user.id,
          specializationId: student.specializationId,
          origin: 'student_proposal',
          status: 'inactive',
          createdAt: now,
          updatedAt: now
        })
        .returning();
      acceptedTopic = createdTopic;
    }

    if (!acceptedTopic) return jsonResponse({ error: 'Topic could not be accepted.' }, { status: 500 });

    const [assignment] = await db
      .insert(topicAssignments)
      .values({
        studentId: topicRequest.studentId,
        professorId: authResult.user.id,
        topicId: acceptedTopic.id,
        title: acceptedTopic.title,
        description: acceptedTopic.description,
        status: 'active',
        createdAt: now,
        updatedAt: now
      })
      .returning();

    await db.update(topicRequests).set({ status: 'accepted', updatedAt: now }).where(eq(topicRequests.id, requestId));

    return { assignment };
  })
  .post('/api/professor/requests/:id/reject', async ({ params, request }) => {
    const authResult = await requireRole(request.headers, 'professor');
    if ('response' in authResult) return authResult.response;

    await expirePendingLifecycleItems();
    const requestId = Number(params.id);
    const topicRequest = await db.select().from(topicRequests).where(eq(topicRequests.id, requestId)).get();
    if (!topicRequest || topicRequest.professorId !== authResult.user.id) {
      return jsonResponse({ error: 'Request not found.' }, { status: 404 });
    }
    if (topicRequest.status !== 'pending') {
      return jsonResponse({ error: 'Only pending requests can be rejected.' }, { status: 400 });
    }

    const now = nowDate();
    await db.update(topicRequests).set({ status: 'rejected', updatedAt: now }).where(eq(topicRequests.id, requestId));

    if (topicRequest.type === 'topic_claim' && topicRequest.topicId) {
      await db
        .update(topics)
        .set({ status: 'available', updatedAt: now })
        .where(and(eq(topics.id, topicRequest.topicId), eq(topics.status, 'reserved')));
    }

    return { ok: true };
  })
  .get('/api/professor/change-requests', async ({ request }) => {
    const authResult = await requireRole(request.headers, 'professor');
    if ('response' in authResult) return authResult.response;

    await expirePendingChangeRequests();
    const rows = await db
      .select()
      .from(topicChangeRequests)
      .where(and(eq(topicChangeRequests.professorId, authResult.user.id), eq(topicChangeRequests.status, 'pending')));
    return { changeRequests: rows };
  })
  .post('/api/professor/change-requests/:id/accept', async ({ params, request }) => {
    const authResult = await requireRole(request.headers, 'professor');
    if ('response' in authResult) return authResult.response;

    await expirePendingChangeRequests();
    const id = Number(params.id);
    const changeRequest = await db.select().from(topicChangeRequests).where(eq(topicChangeRequests.id, id)).get();
    if (!changeRequest || changeRequest.professorId !== authResult.user.id) {
      return jsonResponse({ error: 'Change request not found.' }, { status: 404 });
    }
    if (changeRequest.status !== 'pending') {
      return jsonResponse({ error: 'Only pending change requests can be accepted.' }, { status: 400 });
    }

    const now = nowDate();
    await db
      .update(topicAssignments)
      .set({
        title: changeRequest.requestedTitle,
        description: changeRequest.requestedDescription,
        updatedAt: now
      })
      .where(eq(topicAssignments.id, changeRequest.assignmentId));
    await db.update(topicChangeRequests).set({ status: 'accepted', updatedAt: now }).where(eq(topicChangeRequests.id, id));
    return { ok: true };
  })
  .post('/api/professor/change-requests/:id/reject', async ({ params, request }) => {
    const authResult = await requireRole(request.headers, 'professor');
    if ('response' in authResult) return authResult.response;

    await expirePendingChangeRequests();
    const id = Number(params.id);
    const changeRequest = await db.select().from(topicChangeRequests).where(eq(topicChangeRequests.id, id)).get();
    if (!changeRequest || changeRequest.professorId !== authResult.user.id) {
      return jsonResponse({ error: 'Change request not found.' }, { status: 404 });
    }
    if (changeRequest.status !== 'pending') {
      return jsonResponse({ error: 'Only pending change requests can be rejected.' }, { status: 400 });
    }

    await db.update(topicChangeRequests).set({ status: 'rejected', updatedAt: nowDate() }).where(eq(topicChangeRequests.id, id));
    return { ok: true };
  })
  .get('/api/student/professors', async ({ request }) => {
    const authResult = await requireRole(request.headers, 'student');
    if ('response' in authResult) return authResult.response;

    await expirePendingLifecycleItems();
    const student = authResult.user;
    if (!student.specializationId) return { professors: [], canRequest: false };

    const topicRows = await db
      .select({
        id: topics.id,
        title: topics.title,
        description: topics.description,
        professorId: topics.professorId,
        specializationId: topics.specializationId,
        origin: topics.origin,
        status: topics.status,
        createdAt: topics.createdAt,
        updatedAt: topics.updatedAt
      })
      .from(topics)
      .where(
        and(
          eq(topics.specializationId, student.specializationId),
          eq(topics.origin, 'professor'),
          or(eq(topics.status, 'available'), eq(topics.status, 'reserved'))
        )
      );

    const professorIds = Array.from(new Set(topicRows.map((topic) => topic.professorId)));
    const professorRows = professorIds.length
      ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, professorIds))
      : [];
    const assignedProfessorRows = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(professorSpecializations)
      .innerJoin(users, eq(professorSpecializations.professorId, users.id))
      .where(eq(professorSpecializations.specializationId, student.specializationId));
    const professorMap = new Map(professorRows.map((professor) => [professor.id, { ...professor, topics: [] as unknown[] }]));
    topicRows.forEach((topic) => {
      professorMap.get(topic.professorId)?.topics.push({ ...topic, summary: summarizeWords(topic.description) });
    });

    const canRequest = !(await studentHasPendingRequest(student.id)) && !(await studentHasActiveAssignment(student.id));

    return {
      canRequest,
      professorOptions: assignedProfessorRows,
      professors: Array.from(professorMap.values()).filter((professor) => professor.topics.length > 0)
    };
  })
  .get('/api/student/requests', async ({ request }) => {
    const authResult = await requireRole(request.headers, 'student');
    if ('response' in authResult) return authResult.response;

    await expirePendingLifecycleItems();
    const rows = await buildTopicRequestRows(eq(topicRequests.studentId, authResult.user.id));
    return { requests: rows };
  })
  .get('/api/student/assignment', async ({ request }) => {
    const authResult = await requireRole(request.headers, 'student');
    if ('response' in authResult) return authResult.response;

    await expirePendingLifecycleItems();
    const row = await db
      .select({
        id: topicAssignments.id,
        studentId: topicAssignments.studentId,
        professorId: topicAssignments.professorId,
        topicId: topicAssignments.topicId,
        title: topicAssignments.title,
        description: topicAssignments.description,
        status: topicAssignments.status,
        createdAt: topicAssignments.createdAt,
        professorName: users.name,
        topicOrigin: topics.origin,
        specialization: specializations.name,
        faculty: faculties.name
      })
      .from(topicAssignments)
      .innerJoin(users, eq(topicAssignments.professorId, users.id))
      .innerJoin(topics, eq(topicAssignments.topicId, topics.id))
      .innerJoin(specializations, eq(topics.specializationId, specializations.id))
      .innerJoin(faculties, eq(specializations.facultyId, faculties.id))
      .where(and(eq(topicAssignments.studentId, authResult.user.id), eq(topicAssignments.status, 'active')))
      .get();

    return { assignment: row ? { ...row, summary: summarizeWords(row.description) } : null };
  })
  .post(
    '/api/student/topic-requests',
    async ({ body, request }) => {
      const authResult = await requireRole(request.headers, 'student');
      if ('response' in authResult) return authResult.response;

      await expirePendingLifecycleItems();
      const student = authResult.user;
      if (await studentHasPendingRequest(student.id)) {
        return jsonResponse({ error: 'You already have a pending request.' }, { status: 409 });
      }
      if (await studentHasActiveAssignment(student.id)) {
        return jsonResponse({ error: 'You already have an active assignment.' }, { status: 409 });
      }

      const topicId = Number(body.topicId);
      const topic = await db.select().from(topics).where(eq(topics.id, topicId)).get();
      if (!topic || topic.origin !== 'professor' || topic.specializationId !== student.specializationId) {
        return jsonResponse({ error: 'Topic not found.' }, { status: 404 });
      }
      if (topic.status !== 'available') {
        return jsonResponse({ error: 'This topic is not available.' }, { status: 409 });
      }

      const now = nowDate();
      await db.update(topics).set({ status: 'reserved', updatedAt: now }).where(eq(topics.id, topic.id));
      const [created] = await db
        .insert(topicRequests)
        .values({
          studentId: student.id,
          professorId: topic.professorId,
          topicId: topic.id,
          type: 'topic_claim',
          status: 'pending',
          expiresAt: addMs(now, requestLifetimeMs),
          createdAt: now,
          updatedAt: now
        })
        .returning();

      return jsonResponse({ request: created }, { status: 201 });
    },
    {
      body: t.Object({
        topicId: t.Number()
      })
    }
  )
  .post(
    '/api/student/custom-proposals',
    async ({ body, request }) => {
      const authResult = await requireRole(request.headers, 'student');
      if ('response' in authResult) return authResult.response;

      await expirePendingLifecycleItems();
      const student = authResult.user;
      if (!student.specializationId) {
        return jsonResponse({ error: 'Student specialisation could not be found.' }, { status: 400 });
      }
      if (await studentHasPendingRequest(student.id)) {
        return jsonResponse({ error: 'You already have a pending request.' }, { status: 409 });
      }
      if (await studentHasActiveAssignment(student.id)) {
        return jsonResponse({ error: 'You already have an active assignment.' }, { status: 409 });
      }

      const professorId = body.professorId.trim();
      const professor = await db.select().from(users).where(eq(users.id, professorId)).get();
      if (!professor || professor.role !== 'professor') {
        return jsonResponse({ error: 'Professor not found.' }, { status: 404 });
      }
      if (!(await hasProfessorSpecialization(professorId, student.specializationId))) {
        return jsonResponse({ error: 'Professor is not assigned to your specialisation.' }, { status: 403 });
      }

      const now = nowDate();
      const [created] = await db
        .insert(topicRequests)
        .values({
          studentId: student.id,
          professorId,
          type: 'custom_proposal',
          customTitle: trimRequired(body.title, 'Title'),
          customDescription: trimRequired(body.description, 'Description'),
          status: 'pending',
          expiresAt: addMs(now, requestLifetimeMs),
          createdAt: now,
          updatedAt: now
        })
        .returning();

      return jsonResponse({ request: created }, { status: 201 });
    },
    {
      body: t.Object({
        professorId: t.String(),
        title: t.String(),
        description: t.String()
      })
    }
  )
  .post('/api/student/assignments/:id/abandon', async ({ params, request }) => {
    const authResult = await requireRole(request.headers, 'student');
    if ('response' in authResult) return authResult.response;

    const assignmentId = Number(params.id);
    const assignment = await db.select().from(topicAssignments).where(eq(topicAssignments.id, assignmentId)).get();
    if (!assignment || assignment.studentId !== authResult.user.id) {
      return jsonResponse({ error: 'Assignment not found.' }, { status: 404 });
    }
    if (assignment.status !== 'active') {
      return jsonResponse({ error: 'Only active assignments can be abandoned.' }, { status: 400 });
    }

    const topic = await db.select().from(topics).where(eq(topics.id, assignment.topicId)).get();
    const now = nowDate();
    await db.update(topicAssignments).set({ status: 'abandoned', updatedAt: now }).where(eq(topicAssignments.id, assignment.id));

    if (topic?.origin === 'professor') {
      await db.update(topics).set({ status: 'available', updatedAt: now }).where(eq(topics.id, topic.id));
    }

    return { ok: true };
  })
  .post(
    '/api/student/assignments/:id/change-requests',
    async ({ body, params, request }) => {
      const authResult = await requireRole(request.headers, 'student');
      if ('response' in authResult) return authResult.response;

      await expirePendingChangeRequests();
      const assignmentId = Number(params.id);
      const assignment = await db.select().from(topicAssignments).where(eq(topicAssignments.id, assignmentId)).get();
      if (!assignment || assignment.studentId !== authResult.user.id || assignment.status !== 'active') {
        return jsonResponse({ error: 'Assignment not found.' }, { status: 404 });
      }

      const existing = await db
        .select()
        .from(topicChangeRequests)
        .where(and(eq(topicChangeRequests.assignmentId, assignment.id), eq(topicChangeRequests.status, 'pending')))
        .get();
      if (existing) {
        return jsonResponse({ error: 'This assignment already has a pending change request.' }, { status: 409 });
      }

      const now = nowDate();
      const [created] = await db
        .insert(topicChangeRequests)
        .values({
          assignmentId: assignment.id,
          studentId: authResult.user.id,
          professorId: assignment.professorId,
          requestedTitle: trimRequired(body.title, 'Title'),
          requestedDescription: trimRequired(body.description, 'Description'),
          status: 'pending',
          expiresAt: addMs(now, changeRequestLifetimeMs),
          createdAt: now,
          updatedAt: now
        })
        .returning();

      return jsonResponse({ changeRequest: created }, { status: 201 });
    },
    {
      body: t.Object({
        title: t.String(),
        description: t.String()
      })
    }
  )
  .listen(3000);
