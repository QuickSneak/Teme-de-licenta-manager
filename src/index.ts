import { Elysia, t, type Context } from 'elysia';
import { staticPlugin } from '@elysiajs/static';
import { and, eq, lt, ne } from 'drizzle-orm';
import { auth } from './auth';
import { db } from './db';
import {
  faculties,
  notifications,
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
type TopicRequest = typeof topicRequests.$inferSelect;

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
  if (!user) return { error: jsonResponse({ error: 'Not authenticated.' }, { status: 401 }) };
  if (user.role !== role) return { error: jsonResponse({ error: 'Forbidden.' }, { status: 403 }) };
  return { user };
}

async function getUserSpecializations(userId: string) {
  const rows = await db
    .select()
    .from(professorSpecializations)
    .where(eq(professorSpecializations.professorId, userId));

  return Promise.all(
    rows.map(async (row) => {
      const specialization = await db
        .select()
        .from(specializations)
        .where(eq(specializations.id, row.specializationId))
        .get();
      const faculty = specialization
        ? await db.select().from(faculties).where(eq(faculties.id, specialization.facultyId)).get()
        : null;

      return specialization
        ? {
            id: specialization.id,
            name: specialization.name,
            faculty: faculty ? { id: faculty.id, name: faculty.name } : null
          }
        : null;
    })
  ).then((items) => items.filter((item): item is NonNullable<typeof item> => Boolean(item)));
}

async function createNotification(input: {
  userId: string;
  type: string;
  title: string;
  message: string;
  link?: string;
}) {
  await db.insert(notifications).values({
    userId: input.userId,
    type: input.type,
    title: input.title,
    message: input.message,
    link: input.link,
    isRead: false,
    createdAt: new Date()
  });
}

async function notifyStudentsForSpecialization(specializationId: number, input: Omit<Parameters<typeof createNotification>[0], 'userId'>) {
  const students = await db
    .select()
    .from(users)
    .where(and(eq(users.role, 'student'), eq(users.specializationId, specializationId)));

  await Promise.all(students.map((student) => createNotification({ ...input, userId: student.id })));
}

async function expirePendingWork() {
  const now = new Date();
  const expiredRequests = await db
    .select()
    .from(topicRequests)
    .where(and(eq(topicRequests.status, 'pending'), lt(topicRequests.expiresAt, now)));
  const expiredChanges = await db
    .select()
    .from(topicChangeRequests)
    .where(and(eq(topicChangeRequests.status, 'pending'), lt(topicChangeRequests.expiresAt, now)));

  await db
    .update(topicRequests)
    .set({ status: 'expired', updatedAt: now })
    .where(and(eq(topicRequests.status, 'pending'), lt(topicRequests.expiresAt, now)));

  await db
    .update(topicChangeRequests)
    .set({ status: 'expired', updatedAt: now })
    .where(and(eq(topicChangeRequests.status, 'pending'), lt(topicChangeRequests.expiresAt, now)));

  await Promise.all([
    ...expiredRequests.map((request) =>
      createNotification({
        userId: request.studentId,
        type: 'request_status',
        title: 'Request expired',
        message: `Your pending topic request expired.`,
        link: '/dashboard.html'
      })
    ),
    ...expiredChanges.map((request) =>
      createNotification({
        userId: request.studentId,
        type: 'request_status',
        title: 'Change request expired',
        message: `Your pending topic change request expired.`,
        link: '/dashboard.html'
      })
    )
  ]);
}

function expiresIn72Hours() {
  return new Date(Date.now() + 72 * 60 * 60 * 1000);
}

function expiresIn3Days() {
  return new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
}

async function hasPendingRequest(studentId: string) {
  const request = await db
    .select()
    .from(topicRequests)
    .where(and(eq(topicRequests.studentId, studentId), eq(topicRequests.status, 'pending')))
    .get();

  return Boolean(request);
}

async function getActiveAssignment(studentId: string) {
  return db
    .select()
    .from(topicAssignments)
    .where(and(eq(topicAssignments.studentId, studentId), eq(topicAssignments.status, 'active')))
    .get();
}

async function professorCanUseSpecialization(professorId: string, specializationId: number) {
  const row = await db
    .select()
    .from(professorSpecializations)
    .where(
      and(
        eq(professorSpecializations.professorId, professorId),
        eq(professorSpecializations.specializationId, specializationId)
      )
    )
    .get();

  return Boolean(row);
}

async function serializeRequest(request: TopicRequest) {
  const student = await db.select().from(users).where(eq(users.id, request.studentId)).get();
  const professor = await db.select().from(users).where(eq(users.id, request.professorId)).get();
  const topic = request.topicId ? await db.select().from(topics).where(eq(topics.id, request.topicId)).get() : null;
  const specializationId = topic?.specializationId ?? student?.specializationId ?? null;
  const specialization = specializationId
    ? await db.select().from(specializations).where(eq(specializations.id, specializationId)).get()
    : null;
  const faculty = specialization
    ? await db.select().from(faculties).where(eq(faculties.id, specialization.facultyId)).get()
    : null;

  return {
    id: request.id,
    type: request.type,
    status: request.status,
    title: topic?.title ?? request.customTitle,
    description: topic?.description ?? request.customDescription,
    expiresAt: request.expiresAt,
    createdAt: request.createdAt,
    student: student ? { id: student.id, name: student.name, email: student.email } : null,
    professor: professor ? { id: professor.id, name: professor.name, email: professor.email } : null,
    topic: topic ? { id: topic.id, title: topic.title, status: topic.status, origin: topic.origin } : null,
    faculty: faculty?.name ?? null,
    specialization: specialization?.name ?? null
  };
}

async function serializeTopic(topic: typeof topics.$inferSelect) {
  const specialization = await db
    .select()
    .from(specializations)
    .where(eq(specializations.id, topic.specializationId))
    .get();
  const faculty = specialization
    ? await db.select().from(faculties).where(eq(faculties.id, specialization.facultyId)).get()
    : null;

  return {
    ...topic,
    specialization: specialization ? { id: specialization.id, name: specialization.name } : null,
    faculty: faculty ? { id: faculty.id, name: faculty.name } : null
  };
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
  .get('/api/profile', async ({ request }) => {
    const user = await getCurrentUser(request.headers);
    if (!user) return jsonResponse({ error: 'Not authenticated.' }, { status: 401 });

    const faculty = user.facultyId
      ? await db.select().from(faculties).where(eq(faculties.id, user.facultyId)).get()
      : null;
    const specialization = user.specializationId
      ? await db.select().from(specializations).where(eq(specializations.id, user.specializationId)).get()
      : null;
    const professorSpecialties = user.role === 'professor' ? await getUserSpecializations(user.id) : [];

    return jsonResponse({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        faculty: faculty ? { id: faculty.id, name: faculty.name } : null,
        specialization: specialization ? { id: specialization.id, name: specialization.name } : null,
        professorSpecializations: professorSpecialties,
        professorFaculties: Array.from(
          new Map(
            professorSpecialties
              .map((item) => item.faculty)
              .filter((item): item is NonNullable<typeof item> => Boolean(item))
              .map((item) => [item.id, item])
          ).values()
        )
      }
    });
  })
  .get('/api/notifications', async ({ request }) => {
    const user = await getCurrentUser(request.headers);
    if (!user) return jsonResponse({ error: 'Not authenticated.' }, { status: 401 });

    const rows = await db.select().from(notifications).where(eq(notifications.userId, user.id));
    return jsonResponse({ notifications: rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()) });
  })
  .delete('/api/notifications/:id', async ({ params, request }) => {
    const user = await getCurrentUser(request.headers);
    if (!user) return jsonResponse({ error: 'Not authenticated.' }, { status: 401 });

    const notification = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.id, Number(params.id)), eq(notifications.userId, user.id)))
      .get();

    if (!notification) return jsonResponse({ error: 'Notification not found.' }, { status: 404 });
    await db.delete(notifications).where(eq(notifications.id, notification.id));
    return jsonResponse({ ok: true });
  })
  .get('/api/student/professors', async ({ request }) => {
    await expirePendingWork();
    const authResult = await requireRole(request.headers, 'student');
    if ('error' in authResult) return authResult.error;

    const student = authResult.user;
    if (!student.specializationId) {
      return jsonResponse({ professors: [] });
    }

    const assignments = await db
      .select()
      .from(professorSpecializations)
      .where(eq(professorSpecializations.specializationId, student.specializationId));

    const professors = await Promise.all(
      assignments.map(async (assignment) => {
        const professor = await db.select().from(users).where(eq(users.id, assignment.professorId)).get();
        if (!professor) return null;

        const professorTopics = await db
          .select()
          .from(topics)
          .where(
            and(
              eq(topics.professorId, professor.id),
              eq(topics.specializationId, student.specializationId!),
              ne(topics.status, 'inactive')
            )
          );

        return {
          id: professor.id,
          name: professor.name,
          email: professor.email,
          topics: professorTopics.map((topic) => ({
            id: topic.id,
            title: topic.title,
            description: topic.description,
            status: topic.status,
            origin: topic.origin
          }))
        };
      })
    );

    return jsonResponse({ professors: professors.filter(Boolean) });
  })
  .get('/api/student/requests', async ({ request }) => {
    await expirePendingWork();
    const authResult = await requireRole(request.headers, 'student');
    if ('error' in authResult) return authResult.error;

    const rows = await db.select().from(topicRequests).where(eq(topicRequests.studentId, authResult.user.id));
    return jsonResponse({ requests: await Promise.all(rows.map(serializeRequest)) });
  })
  .get('/api/student/assignment', async ({ request }) => {
    await expirePendingWork();
    const authResult = await requireRole(request.headers, 'student');
    if ('error' in authResult) return authResult.error;

    const assignment = await getActiveAssignment(authResult.user.id);
    if (!assignment) return jsonResponse({ assignment: null });

    const professor = await db.select().from(users).where(eq(users.id, assignment.professorId)).get();
    const topic = await db.select().from(topics).where(eq(topics.id, assignment.topicId)).get();
    const specialization = topic
      ? await db.select().from(specializations).where(eq(specializations.id, topic.specializationId)).get()
      : null;

    return jsonResponse({
      assignment: {
        id: assignment.id,
        title: assignment.title,
        description: assignment.description,
        status: assignment.status,
        createdAt: assignment.createdAt,
        professor: professor ? { id: professor.id, name: professor.name, email: professor.email } : null,
        topic: topic ? { id: topic.id, status: topic.status, origin: topic.origin } : null,
        specialization: specialization?.name ?? null
      }
    });
  })
  .post(
    '/api/student/topic-requests',
    async ({ body, request }) => {
      await expirePendingWork();
      const authResult = await requireRole(request.headers, 'student');
      if ('error' in authResult) return authResult.error;

      const student = authResult.user;
      if (!student.specializationId) return jsonResponse({ error: 'Student has no specialization.' }, { status: 400 });
      if (await hasPendingRequest(student.id)) return jsonResponse({ error: 'You already have a pending request.' }, { status: 409 });
      if (await getActiveAssignment(student.id)) return jsonResponse({ error: 'You already have an active topic assignment.' }, { status: 409 });

      const topic = await db.select().from(topics).where(eq(topics.id, body.topicId)).get();
      if (!topic || topic.status !== 'available' || topic.specializationId !== student.specializationId) {
        return jsonResponse({ error: 'Topic is not available for your specialization.' }, { status: 400 });
      }

      const now = new Date();
      const inserted = await db
        .insert(topicRequests)
        .values({
          studentId: student.id,
          professorId: topic.professorId,
          topicId: topic.id,
          type: 'topic_claim',
          status: 'pending',
          expiresAt: expiresIn72Hours(),
          createdAt: now,
          updatedAt: now
        })
        .returning()
        .get();

      await createNotification({
        userId: topic.professorId,
        type: 'student_request',
        title: 'New topic claim',
        message: `${student.name} requested "${topic.title}".`,
        link: '/professor-proposals.html'
      });

      return jsonResponse({ request: await serializeRequest(inserted) }, { status: 201 });
    },
    { body: t.Object({ topicId: t.Number() }) }
  )
  .post(
    '/api/student/custom-proposals',
    async ({ body, request }) => {
      await expirePendingWork();
      const authResult = await requireRole(request.headers, 'student');
      if ('error' in authResult) return authResult.error;

      const student = authResult.user;
      if (!student.specializationId) return jsonResponse({ error: 'Student has no specialization.' }, { status: 400 });
      if (await hasPendingRequest(student.id)) return jsonResponse({ error: 'You already have a pending request.' }, { status: 409 });
      if (await getActiveAssignment(student.id)) return jsonResponse({ error: 'You already have an active topic assignment.' }, { status: 409 });
      if (!body.title.trim() || !body.description.trim()) {
        return jsonResponse({ error: 'Proposal title and description are required.' }, { status: 400 });
      }
      if (!(await professorCanUseSpecialization(body.professorId, student.specializationId))) {
        return jsonResponse({ error: 'Professor is not assigned to your specialization.' }, { status: 400 });
      }

      const now = new Date();
      const inserted = await db
        .insert(topicRequests)
        .values({
          studentId: student.id,
          professorId: body.professorId,
          type: 'custom_proposal',
          customTitle: body.title.trim(),
          customDescription: body.description.trim(),
          status: 'pending',
          expiresAt: expiresIn72Hours(),
          createdAt: now,
          updatedAt: now
        })
        .returning()
        .get();

      await createNotification({
        userId: body.professorId,
        type: 'student_request',
        title: 'New custom proposal',
        message: `${student.name} proposed "${body.title.trim()}".`,
        link: '/professor-proposals.html'
      });

      return jsonResponse({ request: await serializeRequest(inserted) }, { status: 201 });
    },
    { body: t.Object({ professorId: t.String(), title: t.String(), description: t.String() }) }
  )
  .post('/api/student/assignments/:id/abandon', async ({ params, request }) => {
    await expirePendingWork();
    const authResult = await requireRole(request.headers, 'student');
    if ('error' in authResult) return authResult.error;

    const assignmentId = Number(params.id);
    const assignment = await db
      .select()
      .from(topicAssignments)
      .where(and(eq(topicAssignments.id, assignmentId), eq(topicAssignments.studentId, authResult.user.id)))
      .get();

    if (!assignment || assignment.status !== 'active') {
      return jsonResponse({ error: 'Active assignment not found.' }, { status: 404 });
    }

    const now = new Date();
    await db
      .update(topicAssignments)
      .set({ status: 'abandoned', abandonedAt: now, updatedAt: now })
      .where(eq(topicAssignments.id, assignment.id));

    const topic = await db.select().from(topics).where(eq(topics.id, assignment.topicId)).get();
    if (topic?.origin === 'professor') {
      await db.update(topics).set({ status: 'available', updatedAt: now }).where(eq(topics.id, topic.id));
      await createNotification({
        userId: assignment.professorId,
        type: 'topic_status',
        title: 'Topic available again',
        message: `${authResult.user.name} abandoned "${assignment.title}".`,
        link: '/professor-dashboard.html'
      });
    }

    return jsonResponse({ ok: true });
  })
  .post(
    '/api/student/assignments/:id/change-requests',
    async ({ body, params, request }) => {
      await expirePendingWork();
      const authResult = await requireRole(request.headers, 'student');
      if ('error' in authResult) return authResult.error;

      const assignmentId = Number(params.id);
      const assignment = await db
        .select()
        .from(topicAssignments)
        .where(
          and(
            eq(topicAssignments.id, assignmentId),
            eq(topicAssignments.studentId, authResult.user.id),
            eq(topicAssignments.status, 'active')
          )
        )
        .get();

      if (!assignment) return jsonResponse({ error: 'Active assignment not found.' }, { status: 404 });
      if (!body.title.trim()) return jsonResponse({ error: 'A proposed title is required.' }, { status: 400 });

      const existing = await db
        .select()
        .from(topicChangeRequests)
        .where(and(eq(topicChangeRequests.assignmentId, assignment.id), eq(topicChangeRequests.status, 'pending')))
        .get();

      if (existing) return jsonResponse({ error: 'You already have a pending change request.' }, { status: 409 });

      const now = new Date();
      const inserted = await db
        .insert(topicChangeRequests)
        .values({
          assignmentId: assignment.id,
          studentId: assignment.studentId,
          professorId: assignment.professorId,
          proposedTitle: body.title.trim(),
          proposedDescription: body.description.trim(),
          status: 'pending',
          expiresAt: expiresIn3Days(),
          createdAt: now,
          updatedAt: now
        })
        .returning()
        .get();

      await createNotification({
        userId: assignment.professorId,
        type: 'student_request',
        title: 'Topic change request',
        message: `${authResult.user.name} requested changes to "${assignment.title}".`,
        link: '/professor-proposals.html'
      });

      return jsonResponse({ changeRequest: inserted }, { status: 201 });
    },
    { body: t.Object({ title: t.String(), description: t.String() }) }
  )
  .get('/api/professor/dashboard', async ({ request }) => {
    await expirePendingWork();
    const authResult = await requireRole(request.headers, 'professor');
    if ('error' in authResult) return authResult.error;

    const professor = authResult.user;
    const professorTopics = await db.select().from(topics).where(eq(topics.professorId, professor.id));
    const assignments = await db
      .select()
      .from(topicAssignments)
      .where(and(eq(topicAssignments.professorId, professor.id), eq(topicAssignments.status, 'active')));

    const serializedAssignments = await Promise.all(
      assignments.map(async (assignment) => {
        const student = await db.select().from(users).where(eq(users.id, assignment.studentId)).get();
        const topic = await db.select().from(topics).where(eq(topics.id, assignment.topicId)).get();
        const specialization = topic
          ? await db.select().from(specializations).where(eq(specializations.id, topic.specializationId)).get()
          : null;

        return {
          id: assignment.id,
          title: assignment.title,
          description: assignment.description,
          status: assignment.status,
          student: student ? { id: student.id, name: student.name, email: student.email } : null,
          topic: topic ? { id: topic.id, origin: topic.origin, status: topic.status } : null,
          specialization: specialization?.name ?? null
        };
      })
    );

    return jsonResponse({
      topics: await Promise.all(professorTopics.map(serializeTopic)),
      assignments: serializedAssignments,
      specializations: await getUserSpecializations(professor.id)
    });
  })
  .get('/api/professor/requests', async ({ request }) => {
    await expirePendingWork();
    const authResult = await requireRole(request.headers, 'professor');
    if ('error' in authResult) return authResult.error;

    const rows = await db.select().from(topicRequests).where(eq(topicRequests.professorId, authResult.user.id));
    return jsonResponse({ requests: await Promise.all(rows.map(serializeRequest)) });
  })
  .post(
    '/api/professor/topics',
    async ({ body, request }) => {
      const authResult = await requireRole(request.headers, 'professor');
      if ('error' in authResult) return authResult.error;

      if (!(await professorCanUseSpecialization(authResult.user.id, body.specializationId))) {
        return jsonResponse({ error: 'Professor is not assigned to that specialization.' }, { status: 400 });
      }
      if (!body.title.trim() || !body.description.trim()) {
        return jsonResponse({ error: 'Title and description are required.' }, { status: 400 });
      }

      const now = new Date();
      const topic = await db
        .insert(topics)
        .values({
          title: body.title.trim(),
          description: body.description.trim(),
          professorId: authResult.user.id,
          specializationId: body.specializationId,
          origin: 'professor',
          status: 'available',
          createdAt: now,
          updatedAt: now
        })
        .returning()
        .get();

      await notifyStudentsForSpecialization(body.specializationId, {
        type: 'new_topic',
        title: 'New thesis suggestion',
        message: `${authResult.user.name} added "${topic.title}".`,
        link: '/professors.html'
      });

      return jsonResponse({ topic: await serializeTopic(topic) }, { status: 201 });
    },
    { body: t.Object({ title: t.String(), description: t.String(), specializationId: t.Number() }) }
  )
  .patch(
    '/api/professor/topics/:id',
    async ({ body, params, request }) => {
      const authResult = await requireRole(request.headers, 'professor');
      if ('error' in authResult) return authResult.error;

      const topicId = Number(params.id);
      const topic = await db
        .select()
        .from(topics)
        .where(and(eq(topics.id, topicId), eq(topics.professorId, authResult.user.id)))
        .get();

      if (!topic) return jsonResponse({ error: 'Topic not found.' }, { status: 404 });
      if (topic.status === 'reserved') return jsonResponse({ error: 'Reserved topics cannot be edited.' }, { status: 409 });
      if (body.title !== undefined && !body.title.trim()) {
        return jsonResponse({ error: 'Title is required.' }, { status: 400 });
      }

      const updated = await db
        .update(topics)
        .set({
          title: body.title?.trim() ?? topic.title,
          description: body.description?.trim() ?? topic.description,
          status: body.status ?? topic.status,
          updatedAt: new Date()
        })
        .where(eq(topics.id, topic.id))
        .returning()
        .get();

      await createNotification({
        userId: authResult.user.id,
        type: 'topic_status',
        title: 'Topic updated',
        message: `"${updated.title}" is now ${updated.status}.`,
        link: '/professor-dashboard.html'
      });

      return jsonResponse({ topic: await serializeTopic(updated) });
    },
    {
      body: t.Object({
        title: t.Optional(t.String()),
        description: t.Optional(t.String()),
        status: t.Optional(t.String())
      })
    }
  )
  .post('/api/professor/requests/:id/accept', async ({ params, request }) => {
    await expirePendingWork();
    const authResult = await requireRole(request.headers, 'professor');
    if ('error' in authResult) return authResult.error;

    const requestId = Number(params.id);
    const row = await db
      .select()
      .from(topicRequests)
      .where(and(eq(topicRequests.id, requestId), eq(topicRequests.professorId, authResult.user.id)))
      .get();

    if (!row || row.status !== 'pending') return jsonResponse({ error: 'Pending request not found.' }, { status: 404 });
    if (await getActiveAssignment(row.studentId)) {
      return jsonResponse({ error: 'Student already has an active assignment.' }, { status: 409 });
    }

    const student = await db.select().from(users).where(eq(users.id, row.studentId)).get();
    if (!student?.specializationId) return jsonResponse({ error: 'Student specialization not found.' }, { status: 400 });

    const now = new Date();
    let topic = row.topicId ? await db.select().from(topics).where(eq(topics.id, row.topicId)).get() : null;

    if (row.type === 'topic_claim') {
      if (!topic || topic.status !== 'available') return jsonResponse({ error: 'Topic is no longer available.' }, { status: 409 });
    } else {
      topic = await db
        .insert(topics)
        .values({
          title: row.customTitle ?? 'Custom thesis proposal',
          description: row.customDescription,
          professorId: row.professorId,
          specializationId: student.specializationId,
          origin: 'student_proposal',
          status: 'reserved',
          createdAt: now,
          updatedAt: now
        })
        .returning()
        .get();
    }

    const assignment = await db
      .insert(topicAssignments)
      .values({
        studentId: row.studentId,
        professorId: row.professorId,
        topicId: topic.id,
        requestId: row.id,
        title: topic.title,
        description: topic.description,
        status: 'active',
        createdAt: now,
        updatedAt: now
      })
      .returning()
      .get();

    await db.update(topicRequests).set({ status: 'accepted', updatedAt: now }).where(eq(topicRequests.id, row.id));
    await db.update(topics).set({ status: 'reserved', updatedAt: now }).where(eq(topics.id, topic.id));

    await createNotification({
      userId: row.studentId,
      type: 'request_status',
      title: 'Request accepted',
      message: `Your request for "${topic.title}" was accepted.`,
      link: '/dashboard.html'
    });

    await createNotification({
      userId: row.professorId,
      type: 'topic_status',
      title: 'Topic reserved',
      message: `"${topic.title}" was assigned to ${student.name}.`,
      link: '/professor-dashboard.html'
    });

    if (row.type === 'topic_claim') {
      const competingRequests = await db
        .select()
        .from(topicRequests)
        .where(
          and(
            eq(topicRequests.topicId, topic.id),
            eq(topicRequests.status, 'pending'),
            ne(topicRequests.id, row.id)
          )
        );

      await db
        .update(topicRequests)
        .set({ status: 'rejected', updatedAt: now })
        .where(
          and(
            eq(topicRequests.topicId, topic.id),
            eq(topicRequests.status, 'pending'),
            ne(topicRequests.id, row.id)
          )
        );

      await Promise.all(
        competingRequests.map((request) =>
          createNotification({
            userId: request.studentId,
            type: 'request_status',
            title: 'Request rejected',
            message: `"${topic.title}" was assigned to another student.`,
            link: '/dashboard.html'
          })
        )
      );
    }

    return jsonResponse({ assignment }, { status: 201 });
  })
  .post('/api/professor/requests/:id/reject', async ({ params, request }) => {
    await expirePendingWork();
    const authResult = await requireRole(request.headers, 'professor');
    if ('error' in authResult) return authResult.error;

    const requestId = Number(params.id);
    const row = await db
      .select()
      .from(topicRequests)
      .where(and(eq(topicRequests.id, requestId), eq(topicRequests.professorId, authResult.user.id)))
      .get();

    if (!row || row.status !== 'pending') return jsonResponse({ error: 'Pending request not found.' }, { status: 404 });

    const updated = await db
      .update(topicRequests)
      .set({ status: 'rejected', updatedAt: new Date() })
      .where(eq(topicRequests.id, row.id))
      .returning()
      .get();

    await createNotification({
      userId: row.studentId,
      type: 'request_status',
      title: 'Request rejected',
      message: `Your request "${row.customTitle ?? 'Topic claim'}" was rejected.`,
      link: '/dashboard.html'
    });

    return jsonResponse({ request: await serializeRequest(updated) });
  })
  .get('/api/professor/change-requests', async ({ request }) => {
    await expirePendingWork();
    const authResult = await requireRole(request.headers, 'professor');
    if ('error' in authResult) return authResult.error;

    const rows = await db
      .select()
      .from(topicChangeRequests)
      .where(eq(topicChangeRequests.professorId, authResult.user.id));

    const serialized = await Promise.all(
      rows.map(async (row) => {
        const student = await db.select().from(users).where(eq(users.id, row.studentId)).get();
        return {
          ...row,
          student: student ? { id: student.id, name: student.name, email: student.email } : null
        };
      })
    );

    return jsonResponse({ changeRequests: serialized });
  })
  .post('/api/professor/change-requests/:id/accept', async ({ params, request }) => {
    await expirePendingWork();
    const authResult = await requireRole(request.headers, 'professor');
    if ('error' in authResult) return authResult.error;

    const row = await db
      .select()
      .from(topicChangeRequests)
      .where(and(eq(topicChangeRequests.id, Number(params.id)), eq(topicChangeRequests.professorId, authResult.user.id)))
      .get();

    if (!row || row.status !== 'pending') return jsonResponse({ error: 'Pending change request not found.' }, { status: 404 });

    const now = new Date();
    await db
      .update(topicAssignments)
      .set({ title: row.proposedTitle, description: row.proposedDescription, updatedAt: now })
      .where(eq(topicAssignments.id, row.assignmentId));

    const updated = await db
      .update(topicChangeRequests)
      .set({ status: 'accepted', updatedAt: now })
      .where(eq(topicChangeRequests.id, row.id))
      .returning()
      .get();

    await createNotification({
      userId: row.studentId,
      type: 'request_status',
      title: 'Change request accepted',
      message: `Your topic change request was accepted.`,
      link: '/dashboard.html'
    });

    return jsonResponse({ changeRequest: updated });
  })
  .post('/api/professor/change-requests/:id/reject', async ({ params, request }) => {
    await expirePendingWork();
    const authResult = await requireRole(request.headers, 'professor');
    if ('error' in authResult) return authResult.error;

    const row = await db
      .select()
      .from(topicChangeRequests)
      .where(and(eq(topicChangeRequests.id, Number(params.id)), eq(topicChangeRequests.professorId, authResult.user.id)))
      .get();

    if (!row || row.status !== 'pending') return jsonResponse({ error: 'Pending change request not found.' }, { status: 404 });

    const updated = await db
      .update(topicChangeRequests)
      .set({ status: 'rejected', updatedAt: new Date() })
      .where(eq(topicChangeRequests.id, row.id))
      .returning()
      .get();

    await createNotification({
      userId: row.studentId,
      type: 'request_status',
      title: 'Change request rejected',
      message: `Your topic change request was rejected.`,
      link: '/dashboard.html'
    });

    return jsonResponse({ changeRequest: updated });
  })
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
