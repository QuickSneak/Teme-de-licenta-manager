import { Elysia, t, type Context } from 'elysia';
import { staticPlugin } from '@elysiajs/static';
import { hashPassword } from 'better-auth/crypto';
import { and, desc, eq, inArray, lt, ne, or } from 'drizzle-orm';
import { auth } from './auth';
import { db } from './db';
import {
  accounts,
  faculties,
  notifications,
  professorSpecializations,
  sessions,
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
type TopicRequestRow = typeof topicRequests.$inferSelect;

const requestLifetimeMs = 72 * 60 * 60 * 1000;
const changeRequestLifetimeMs = 3 * 24 * 60 * 60 * 1000;
const pageRoot = 'src/pages';
const minuteMs = 60 * 1000;
const hourMs = 60 * minuteMs;
const dayMs = 24 * hourMs;
const textLimits = {
  userName: 120,
  academicTitle: 80,
  officeLocation: 160,
  workingHours: 160,
  profileBio: 1000,
  topicTitle: 180,
  topicDescription: 4000
};
const securityHeaders: Record<string, string> = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self'"
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()'
};
const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const rateLimitPolicies = {
  loginIp: { limit: 30, windowMs: 15 * minuteMs, message: 'Too many login attempts. Try again later.' },
  loginFailedEmail: { limit: 5, windowMs: 15 * minuteMs, message: 'Too many failed login attempts for this email. Try again later.' },
  registrationIp: { limit: 5, windowMs: 20 * minuteMs, message: 'Too many registration attempts. Try again later.' },
  registrationEmail: { limit: 3, windowMs: 20 * minuteMs, message: 'Too many registration attempts for this email. Try again later.' },
  passwordResetIp: { limit: 10, windowMs: 20 * minuteMs, message: 'Too many password reset requests. Try again later.' },
  passwordResetEmail: { limit: 3, windowMs: 20 * minuteMs, message: 'Too many password reset requests for this email. Try again later.' },
  verificationEmailIp: { limit: 10, windowMs: 20 * minuteMs, message: 'Too many verification email requests. Try again later.' },
  verificationEmail: { limit: 3, windowMs: 20 * minuteMs, message: 'Too many verification email requests for this email. Try again later.' },
  studentProposal: { limit: 20, windowMs: dayMs, message: 'Too many thesis request actions today. Try again later.' },
  studentEditRequest: { limit: 20, windowMs: dayMs, message: 'Too many edit request submissions today. Try again later.' },
  authenticatedMutation: { limit: 300, windowMs: hourMs, message: 'Too many account actions. Try again later.' }
};
type RateLimitPolicy = {
  limit: number;
  windowMs: number;
  message: string;
};
type RateLimitBucket = {
  count: number;
  resetAt: number;
};
const rateLimitBuckets = new Map<string, RateLimitBucket>();

function jsonResponse(body: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set('content-type', 'application/json');
  applySecurityHeaders(headers);
  return new Response(JSON.stringify(body), { ...init, headers });
}

function withAuthHeaders(body: unknown, headers: Headers, status = 200) {
  headers.set('content-type', 'application/json');
  applySecurityHeaders(headers);
  return new Response(JSON.stringify(body), { status, headers });
}

function rateLimitResponse(policy: RateLimitPolicy, retryAfterSeconds: number) {
  return jsonResponse(
    { error: policy.message },
    {
      status: 429,
      headers: { 'retry-after': String(retryAfterSeconds) }
    }
  );
}

function bucketFor(key: string, policy: RateLimitPolicy) {
  const now = Date.now();
  const existing = rateLimitBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    const bucket = { count: 0, resetAt: now + policy.windowMs };
    rateLimitBuckets.set(key, bucket);
    return bucket;
  }

  return existing;
}

function retryAfterSeconds(bucket: RateLimitBucket) {
  return Math.max(1, Math.ceil((bucket.resetAt - Date.now()) / 1000));
}

function isRateLimited(key: string, policy: RateLimitPolicy) {
  const bucket = bucketFor(key, policy);
  if (bucket.count < policy.limit) return null;
  return rateLimitResponse(policy, retryAfterSeconds(bucket));
}

function consumeRateLimit(key: string, policy: RateLimitPolicy) {
  const bucket = bucketFor(key, policy);
  if (bucket.count >= policy.limit) {
    return rateLimitResponse(policy, retryAfterSeconds(bucket));
  }

  bucket.count += 1;
  return null;
}

function resetRateLimit(key: string) {
  rateLimitBuckets.delete(key);
}

function rateLimitKey(scope: string, identifier: string) {
  return `${scope}:${identifier}`;
}

function normalizeRateLimitEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : null;
}

function getClientIdentifier(request: Request) {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return (
    forwardedFor ||
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-real-ip') ||
    request.headers.get('forwarded') ||
    'local'
  );
}

async function requestJsonBody(request: Request) {
  try {
    return await request.clone().json();
  } catch {
    return null;
  }
}

function applySecurityHeaders(headers: Headers) {
  for (const [name, value] of Object.entries(securityHeaders)) {
    if (!headers.has(name)) headers.set(name, value);
  }
}

function applySecurityHeadersToSet(headers: Record<string, unknown>) {
  for (const [name, value] of Object.entries(securityHeaders)) {
    if (headers[name] === undefined) headers[name] = value;
  }
}

function withSecurityHeaders(response: Response) {
  try {
    applySecurityHeaders(response.headers);
    return response;
  } catch {
    const headers = new Headers(response.headers);
    applySecurityHeaders(headers);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
}

function configuredOrigin(value?: string) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function trustedOriginsForRequest(requestURL: URL) {
  const origins = new Set<string>();
  const appOrigin = configuredOrigin(process.env.APP_URL);
  const authOrigin = configuredOrigin(process.env.BETTER_AUTH_URL);
  const isProduction = process.env.NODE_ENV === 'production';

  if (appOrigin) origins.add(appOrigin);
  if (authOrigin) origins.add(authOrigin);

  if (!isProduction) {
    origins.add('http://localhost:3000');
    origins.add(requestURL.origin);
  }

  return origins;
}

function requestHeaderOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isAuthRoute(pathname: string) {
  return pathname === '/api/auth' || pathname.startsWith('/api/auth/');
}

function isTrustedRequestOrigin(request: Request, requestURL: URL) {
  if (!unsafeMethods.has(request.method) || isAuthRoute(requestURL.pathname)) return true;

  const origins = trustedOriginsForRequest(requestURL);
  const origin = request.headers.get('origin');
  if (origin) {
    const parsedOrigin = requestHeaderOrigin(origin);
    return parsedOrigin !== null && origins.has(parsedOrigin);
  }

  const referer = request.headers.get('referer');
  if (referer) {
    const parsedReferer = requestHeaderOrigin(referer);
    return parsedReferer !== null && origins.has(parsedReferer);
  }

  return true;
}

async function applyAuthRouteRateLimits(request: Request, requestURL: URL) {
  if (request.method !== 'POST') return null;

  const client = getClientIdentifier(request);
  const body = await requestJsonBody(request);
  const email = normalizeRateLimitEmail(body && typeof body === 'object' && 'email' in body ? body.email : null);

  if (requestURL.pathname === '/api/auth/request-password-reset') {
    const ipLimit = consumeRateLimit(rateLimitKey('password-reset-ip', client), rateLimitPolicies.passwordResetIp);
    if (ipLimit) return ipLimit;

    if (email) {
      const emailLimit = consumeRateLimit(rateLimitKey('password-reset-email', email), rateLimitPolicies.passwordResetEmail);
      if (emailLimit) return emailLimit;
    }
  }

  if (requestURL.pathname === '/api/auth/send-verification-email') {
    const ipLimit = consumeRateLimit(rateLimitKey('verification-email-ip', client), rateLimitPolicies.verificationEmailIp);
    if (ipLimit) return ipLimit;

    if (email) {
      const emailLimit = consumeRateLimit(rateLimitKey('verification-email', email), rateLimitPolicies.verificationEmail);
      if (emailLimit) return emailLimit;
    }
  }

  return null;
}

async function applyAppMutationRateLimits(request: Request, requestURL: URL) {
  if (!unsafeMethods.has(request.method)) return null;
  if (isAuthRoute(requestURL.pathname) || requestURL.pathname === '/login' || requestURL.pathname === '/register') return null;

  const user = await getCurrentUser(request.headers);
  if (!user) return null;

  if (request.method === 'POST' && (requestURL.pathname === '/api/student/topic-requests' || requestURL.pathname === '/api/student/custom-proposals')) {
    const studentProposalLimit = consumeRateLimit(rateLimitKey('student-proposal', user.id), rateLimitPolicies.studentProposal);
    if (studentProposalLimit) return studentProposalLimit;
  }

  if (request.method === 'POST' && /^\/api\/student\/assignments\/[^/]+\/change-requests$/.test(requestURL.pathname)) {
    const studentEditLimit = consumeRateLimit(rateLimitKey('student-edit-request', user.id), rateLimitPolicies.studentEditRequest);
    if (studentEditLimit) return studentEditLimit;
  }

  return consumeRateLimit(rateLimitKey('authenticated-mutation', user.id), rateLimitPolicies.authenticatedMutation);
}

async function authHandlerResponse(request: Request) {
  return withSecurityHeaders(await auth.handler(request));
}

async function betterAuthView(context: Context) {
  if (context.request.method !== 'GET' && context.request.method !== 'POST') {
    return withSecurityHeaders(new Response(null, { status: 405 }));
  }

  return authHandlerResponse(context.request);
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

function pageFile(fileName: string) {
  const headers = new Headers();
  if (fileName.endsWith('.html')) headers.set('content-type', 'text/html; charset=utf-8');
  applySecurityHeaders(headers);
  return new Response(Bun.file(`${pageRoot}/${fileName}`), { headers });
}

function redirectResponse(location: string) {
  return withSecurityHeaders(new Response(null, {
    status: 302,
    headers: { location }
  }));
}

async function protectedPage(headers: Headers, role: UserRole, fileName: string) {
  const user = await getCurrentUser(headers);
  if (!user) return redirectResponse('/login.html');
  if (user.role !== role) {
    return redirectResponse(isUserRole(user.role) ? dashboardByRole[user.role] : '/login.html');
  }

  return pageFile(fileName);
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

async function createNotification(input: {
  userId: string;
  actorId?: string | null;
  type: string;
  title: string;
  message: string;
  entityType?: string | null;
  entityId?: number | null;
  topicTitle?: string | null;
  createdAt?: Date;
}) {
  await db.insert(notifications).values({
    userId: input.userId,
    actorId: input.actorId ?? null,
    type: input.type,
    title: input.title,
    message: input.message,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    topicTitle: input.topicTitle ?? null,
    isCleared: false,
    createdAt: input.createdAt ?? nowDate()
  });
}

async function topicRequestTitle(request: TopicRequestRow) {
  if (request.type === 'custom_proposal') return request.customTitle ?? 'Custom proposal';
  if (!request.topicId) return 'Topic request';

  const topic = await db.select({ title: topics.title }).from(topics).where(eq(topics.id, request.topicId)).get();
  return topic?.title ?? 'Topic request';
}

async function notifyEligibleStudentsForTopic(topic: typeof topics.$inferSelect, professor: UserWithRole) {
  const studentRows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'student'), eq(users.specializationId, topic.specializationId)));

  if (!studentRows.length) return;

  const studentIds = studentRows.map((student) => student.id);
  const activeAssignments = await db
    .select({ studentId: topicAssignments.studentId })
    .from(topicAssignments)
    .where(and(inArray(topicAssignments.studentId, studentIds), eq(topicAssignments.status, 'active')));
  const assignedStudentIds = new Set(activeAssignments.map((assignment) => assignment.studentId));
  const now = nowDate();

  await Promise.all(
    studentRows
      .filter((student) => !assignedStudentIds.has(student.id))
      .map((student) =>
        createNotification({
          userId: student.id,
          actorId: professor.id,
          type: 'topic_suggestion_added',
          title: 'New topic suggestion',
          message: `${professor.name} added "${topic.title}".`,
          entityType: 'topic',
          entityId: topic.id,
          topicTitle: topic.title,
          createdAt: now
        })
      )
  );
}

function validateRequiredText(value: string, label: string, maxLength: number) {
  const trimmed = value.trim();
  if (!trimmed) {
    return { response: jsonResponse({ error: `${label} is required.` }, { status: 400 }) };
  }
  if (trimmed.length > maxLength) {
    return { response: jsonResponse({ error: `${label} must be ${maxLength} characters or fewer.` }, { status: 400 }) };
  }

  return { value: trimmed };
}

function validateOptionalText(value: string, label: string, maxLength: number) {
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    return { response: jsonResponse({ error: `${label} must be ${maxLength} characters or fewer.` }, { status: 400 }) };
  }

  return { value: trimmed };
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
    db.transaction((tx) => {
      const expiredRequest = tx
        .update(topicRequests)
        .set({ status: 'expired', updatedAt: now })
        .where(and(eq(topicRequests.id, request.id), eq(topicRequests.status, 'pending')))
        .returning()
        .get();
      if (!expiredRequest) return;

      if (request.type === 'topic_claim' && request.topicId) {
        tx.update(topics)
          .set({ status: 'available', updatedAt: now })
          .where(and(eq(topics.id, request.topicId), eq(topics.status, 'reserved')))
          .run();
      }
    });
  }
}

async function expirePendingChangeRequests() {
  const now = nowDate();
  const inactiveRows = await db
    .select({ id: topicChangeRequests.id })
    .from(topicChangeRequests)
    .innerJoin(topicAssignments, eq(topicChangeRequests.assignmentId, topicAssignments.id))
    .where(and(eq(topicChangeRequests.status, 'pending'), ne(topicAssignments.status, 'active')));
  const inactiveIds = inactiveRows.map((row) => row.id);

  if (inactiveIds.length) {
    await db
      .update(topicChangeRequests)
      .set({ status: 'cancelled', updatedAt: now })
      .where(inArray(topicChangeRequests.id, inactiveIds));
  }

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
      studentHidden: topicRequests.studentHidden,
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
    role: user.role,
    image: user.image ?? '',
    academicTitle: user.academicTitle ?? '',
    officeLocation: user.officeLocation ?? '',
    workingHours: user.workingHours ?? '',
    isHidden: user.isHidden
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

function isSqliteConstraintError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return error.message.includes('UNIQUE constraint failed') || error.message.includes('constraint failed');
}

function validateUabEmail(value: string, label = 'Email') {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@uab\.ro$/.test(email)) {
    return { response: jsonResponse({ error: `${label} must be a valid @uab.ro email.` }, { status: 400 }) };
  }

  return { value: email };
}

function validatePassword(value: string) {
  const password = value.trim();
  if (password.length < 8) {
    return { response: jsonResponse({ error: 'Password must be at least 8 characters.' }, { status: 400 }) };
  }
  if (password.length > 128) {
    return { response: jsonResponse({ error: 'Password must be 128 characters or fewer.' }, { status: 400 }) };
  }

  return { value: password };
}

function accountId() {
  return crypto.randomUUID();
}

function publicSecretaryRow(secretary: AuthUser | null) {
  if (!secretary) return null;

  return {
    id: secretary.id,
    name: secretary.name,
    email: secretary.email,
    facultyId: secretary.facultyId,
    emailVerified: secretary.emailVerified,
    createdAt: secretary.createdAt,
    updatedAt: secretary.updatedAt
  };
}

async function buildAdminSecretaryResponse() {
  const facultyRows = await db.select().from(faculties);
  const secretaryRows = await db.select().from(users).where(eq(users.role, 'secretary'));
  const secretariesByFaculty = new Map(secretaryRows.map((secretary) => [secretary.facultyId, secretary]));

  return {
    faculties: facultyRows.map((faculty) => ({
      id: faculty.id,
      name: faculty.name,
      secretary: publicSecretaryRow(secretariesByFaculty.get(faculty.id) ?? null)
    })),
    secretaries: secretaryRows.map(publicSecretaryRow)
  };
}

async function getSecretaryFaculty(user: UserWithRole) {
  if (!user.facultyId) {
    return { response: jsonResponse({ error: 'Secretary faculty assignment is missing.' }, { status: 400 }) };
  }

  const faculty = await db.select().from(faculties).where(eq(faculties.id, user.facultyId)).get();
  if (!faculty) return { response: jsonResponse({ error: 'Secretary faculty could not be found.' }, { status: 404 }) };

  return { faculty };
}

async function getFacultySpecializations(facultyId: number) {
  return db.select().from(specializations).where(eq(specializations.facultyId, facultyId));
}

async function getSecretaryProfessorRows(facultyId: number) {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      bio: users.bio,
      academicTitle: users.academicTitle,
      officeLocation: users.officeLocation,
      workingHours: users.workingHours,
      isHidden: users.isHidden,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      specializationId: specializations.id,
      specialization: specializations.name
    })
    .from(professorSpecializations)
    .innerJoin(users, eq(professorSpecializations.professorId, users.id))
    .innerJoin(specializations, eq(professorSpecializations.specializationId, specializations.id))
    .where(and(eq(users.role, 'professor'), eq(specializations.facultyId, facultyId)));

  const professors = new Map<string, {
    id: string;
    name: string;
    email: string;
    bio: string;
    academicTitle: string;
    officeLocation: string;
    workingHours: string;
    isHidden: boolean;
    createdAt: Date;
    updatedAt: Date;
    specializations: { id: number; name: string }[];
  }>();

  rows.forEach((row) => {
    const existing = professors.get(row.id) ?? {
      id: row.id,
      name: row.name,
      email: row.email,
      bio: row.bio ?? '',
      academicTitle: row.academicTitle ?? '',
      officeLocation: row.officeLocation ?? '',
      workingHours: row.workingHours ?? '',
      isHidden: row.isHidden,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      specializations: []
    };

    existing.specializations.push({ id: row.specializationId, name: row.specialization });
    professors.set(row.id, existing);
  });

  return Array.from(professors.values()).sort((a, b) => a.name.localeCompare(b.name));
}

async function buildSecretaryProfessorResponse(secretary: UserWithRole) {
  const facultyResult = await getSecretaryFaculty(secretary);
  if ('response' in facultyResult) return facultyResult.response;

  const facultyId = facultyResult.faculty.id;
  const facultySpecializations = await getFacultySpecializations(facultyId);
  const professors = await getSecretaryProfessorRows(facultyId);

  return {
    faculty: facultyResult.faculty,
    specializations: facultySpecializations,
    professors,
    summary: {
      total: professors.length,
      hidden: professors.filter((professor) => professor.isHidden).length,
      visible: professors.filter((professor) => !professor.isHidden).length
    }
  };
}

async function validateSecretarySpecializationIds(facultyId: number, specializationIds: number[]) {
  const allowed = await getFacultySpecializations(facultyId);
  const allowedIds = new Set(allowed.map((specialization) => specialization.id));
  const uniqueIds = Array.from(new Set(specializationIds.map(Number))).filter((id) => Number.isInteger(id));

  if (!uniqueIds.length) {
    return { response: jsonResponse({ error: 'At least one faculty specialisation is required.' }, { status: 400 }) };
  }

  if (uniqueIds.some((id) => !allowedIds.has(id))) {
    return { response: jsonResponse({ error: 'One or more specialisations are outside your faculty.' }, { status: 403 }) };
  }

  return { value: uniqueIds };
}

async function buildSecretaryStatisticsResponse(secretary: UserWithRole) {
  const facultyResult = await getSecretaryFaculty(secretary);
  if ('response' in facultyResult) return facultyResult.response;

  await expirePendingLifecycleItems();
  const facultyId = facultyResult.faculty.id;
  const facultySpecializations = await getFacultySpecializations(facultyId);
  const specializationIds = facultySpecializations.map((specialization) => specialization.id);
  const professors = await getSecretaryProfessorRows(facultyId);
  const professorIds = professors.map((professor) => professor.id);

  const topicRows = specializationIds.length
    ? await db
        .select({
          id: topics.id,
          title: topics.title,
          description: topics.description,
          origin: topics.origin,
          status: topics.status,
          professorId: topics.professorId,
          professorName: users.name,
          specializationId: specializations.id,
          specialization: specializations.name,
          createdAt: topics.createdAt,
          updatedAt: topics.updatedAt
        })
        .from(topics)
        .innerJoin(users, eq(topics.professorId, users.id))
        .innerJoin(specializations, eq(topics.specializationId, specializations.id))
        .where(inArray(topics.specializationId, specializationIds))
    : [];

  const professorsWithTopics = new Set(topicRows.map((topic) => topic.professorId));
  const createdSince = new Date(Date.now() - 30 * dayMs);

  return {
    faculty: facultyResult.faculty,
    specializations: facultySpecializations,
    professors,
    topics: topicRows,
    summary: {
      totalProfessors: professors.length,
      totalTheses: topicRows.length,
      professorsWithoutTheses: professorIds.filter((id) => !professorsWithTopics.has(id)).length,
      recentlyAddedProfessors: professors.filter((professor) => professor.createdAt >= createdSince).length,
      professorMadeTheses: topicRows.filter((topic) => topic.origin === 'professor').length,
      studentProposedTheses: topicRows.filter((topic) => topic.origin === 'student_proposal').length
    }
  };
}

async function updateCredentialPassword(userId: string, password: string, now: Date) {
  const passwordHash = await hashPassword(password);
  const credential = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')))
    .get();

  if (credential) {
    await db.update(accounts).set({ password: passwordHash, updatedAt: now }).where(eq(accounts.id, credential.id));
  } else {
    await db.insert(accounts).values({
      id: accountId(),
      accountId: userId,
      providerId: 'credential',
      userId,
      password: passwordHash,
      createdAt: now,
      updatedAt: now
    });
  }

  await db.delete(sessions).where(eq(sessions.userId, userId));
}

new Elysia()
  .onRequest(async ({ request, set }) => {
    applySecurityHeadersToSet(set.headers as Record<string, unknown>);

    const requestURL = new URL(request.url);
    if (isAuthRoute(requestURL.pathname)) {
      const rateLimit = await applyAuthRouteRateLimits(request, requestURL);
      if (rateLimit) return rateLimit;

      return authHandlerResponse(request);
    }

    if (!isTrustedRequestOrigin(request, requestURL)) {
      return jsonResponse({ error: 'Cross-origin request rejected.' }, { status: 403 });
    }

    const rateLimit = await applyAppMutationRateLimits(request, requestURL);
    if (rateLimit) return rateLimit;
  })
  .all('/api/auth/verify-email', betterAuthView)
  .all('/api/auth/reset-password/:token', betterAuthView)
  .all('/api/auth/reset-password', betterAuthView)
  .all('/api/auth/request-password-reset', betterAuthView)
  .all('/api/auth/send-verification-email', betterAuthView)
  .all('/api/auth/*', betterAuthView)
  .get('/', () => pageFile('login.html'))
  .get('/login.html', () => pageFile('login.html'))
  .get('/register.html', () => pageFile('register.html'))
  .get('/admin.html', () => pageFile('admin.html'))
  .get('/reset-password.html', () => pageFile('reset-password.html'))
  .get('/verify-email.html', () => pageFile('verify-email.html'))
  .get('/dashboard.html', async ({ request }) => protectedPage(request.headers, 'student', 'dashboard.html'))
  .get('/professors.html', async ({ request }) => protectedPage(request.headers, 'student', 'professors.html'))
  .get('/propose.html', async ({ request }) => protectedPage(request.headers, 'student', 'propose.html'))
  .get('/profile.html', async ({ request }) => protectedPage(request.headers, 'student', 'profile.html'))
  .get('/professor-dashboard.html', async ({ request }) =>
    protectedPage(request.headers, 'professor', 'professor-dashboard.html')
  )
  .get('/professor_add_thesis.html', async ({ request }) =>
    protectedPage(request.headers, 'professor', 'professor_add_thesis.html')
  )
  .get('/professor-proposals.html', async ({ request }) =>
    protectedPage(request.headers, 'professor', 'professor-proposals.html')
  )
  .get('/professor-profile.html', async ({ request }) =>
    protectedPage(request.headers, 'professor', 'professor-profile.html')
  )
  .get('/secretary-dashboard.html', async ({ request }) =>
    protectedPage(request.headers, 'secretary', 'secretary-dashboard.html')
  )
  .get('/secretary-statistics.html', async ({ request }) =>
    protectedPage(request.headers, 'secretary', 'secretary-statistics.html')
  )
  .get('/secretary-profile.html', async ({ request }) =>
    protectedPage(request.headers, 'secretary', 'secretary-profile.html')
  )
  .use(staticPlugin({ assets: 'public', prefix: '', headers: securityHeaders }))
  .post(
    '/admin/login',
    async ({ body, request }) => {
      const email = body.email.trim().toLowerCase();
      const client = getClientIdentifier(request);
      const loginIpLimit = consumeRateLimit(rateLimitKey('login-ip', client), rateLimitPolicies.loginIp);
      if (loginIpLimit) return loginIpLimit;

      const failedEmailKey = rateLimitKey('login-failed-email', email);
      const failedEmailLimit = isRateLimited(failedEmailKey, rateLimitPolicies.loginFailedEmail);
      if (failedEmailLimit) return failedEmailLimit;

      const user = await db.select().from(users).where(eq(users.email, email)).get();
      if (!user || user.role !== 'admin') {
        consumeRateLimit(failedEmailKey, rateLimitPolicies.loginFailedEmail);
        return jsonResponse({ error: 'Invalid admin credentials.' }, { status: 401 });
      }

      try {
        const result = await auth.api.signInEmail({
          body: {
            email,
            password: body.password,
            rememberMe: true
          },
          headers: request.headers,
          returnHeaders: true
        });

        resetRateLimit(failedEmailKey);
        return withAuthHeaders({ ok: true, redirect: '/admin.html' }, result.headers);
      } catch {
        consumeRateLimit(failedEmailKey, rateLimitPolicies.loginFailedEmail);
        return jsonResponse({ error: 'Invalid admin credentials.' }, { status: 401 });
      }
    },
    {
      body: t.Object({
        email: t.String(),
        password: t.String()
      })
    }
  )
  .post(
    '/login',
    async ({ body, request }) => {
      const email = body.email.trim().toLowerCase();
      const role = body.role;
      const client = getClientIdentifier(request);
      const loginIpLimit = consumeRateLimit(rateLimitKey('login-ip', client), rateLimitPolicies.loginIp);
      if (loginIpLimit) return loginIpLimit;

      const failedEmailKey = rateLimitKey('login-failed-email', email);
      const failedEmailLimit = isRateLimited(failedEmailKey, rateLimitPolicies.loginFailedEmail);
      if (failedEmailLimit) return failedEmailLimit;

      if (!isUserRole(role)) {
        return jsonResponse({ error: 'Invalid role.' }, { status: 400 });
      }

      if (role === 'admin') {
        return jsonResponse({ error: 'Use the admin access page.' }, { status: 403 });
      }

      const user = await db.select().from(users).where(eq(users.email, email)).get();
      if (!user || user.role !== role) {
        consumeRateLimit(failedEmailKey, rateLimitPolicies.loginFailedEmail);
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

        resetRateLimit(failedEmailKey);
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

        consumeRateLimit(failedEmailKey, rateLimitPolicies.loginFailedEmail);
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
      const client = getClientIdentifier(request);
      const registrationIpLimit = consumeRateLimit(rateLimitKey('registration-ip', client), rateLimitPolicies.registrationIp);
      if (registrationIpLimit) return registrationIpLimit;

      const registrationEmail = normalizeRateLimitEmail(body.email);
      if (registrationEmail) {
        const registrationEmailLimit = consumeRateLimit(
          rateLimitKey('registration-email', registrationEmail),
          rateLimitPolicies.registrationEmail
        );
        if (registrationEmailLimit) return registrationEmailLimit;
      }

      const role = body.role as UserRole;
      const password = body.password.trim();
      const nameResult = validateRequiredText(body.name, 'Full name', textLimits.userName);
      if ('response' in nameResult) return nameResult.response;

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
            name: nameResult.value,
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
  .get('/api/admin/secretaries', async ({ request }) => {
    const authResult = await requireRole(request.headers, 'admin');
    if ('response' in authResult) return authResult.response;

    return buildAdminSecretaryResponse();
  })
  .post(
    '/api/admin/secretaries',
    async ({ body, request }) => {
      const authResult = await requireRole(request.headers, 'admin');
      if ('response' in authResult) return authResult.response;

      const nameResult = validateRequiredText(body.name, 'Full name', textLimits.userName);
      if ('response' in nameResult) return nameResult.response;
      const emailResult = validateUabEmail(body.email);
      if ('response' in emailResult) return emailResult.response;
      const passwordResult = validatePassword(body.password);
      if ('response' in passwordResult) return passwordResult.response;

      const facultyId = Number(body.facultyId);
      const faculty = await db.select().from(faculties).where(eq(faculties.id, facultyId)).get();
      if (!faculty) return jsonResponse({ error: 'Faculty not found.' }, { status: 404 });

      const existingEmail = await db.select().from(users).where(eq(users.email, emailResult.value)).get();
      if (existingEmail) return jsonResponse({ error: 'An account with this email already exists.' }, { status: 409 });

      const existingSecretary = await db
        .select()
        .from(users)
        .where(and(eq(users.role, 'secretary'), eq(users.facultyId, facultyId)))
        .get();
      if (existingSecretary) return jsonResponse({ error: 'This faculty already has a secretary account.' }, { status: 409 });

      const now = nowDate();
      const id = accountId();
      const passwordHash = await hashPassword(passwordResult.value);

      try {
        db.transaction((tx) => {
          tx.insert(users)
            .values({
              id,
              email: emailResult.value,
              name: nameResult.value,
              bio: '',
              role: 'secretary',
              facultyId,
              specializationId: null,
              isExtended: false,
              emailVerified: true,
              createdAt: now,
              updatedAt: now
            })
            .run();

          tx.insert(accounts)
            .values({
              id: accountId(),
              accountId: id,
              providerId: 'credential',
              userId: id,
              password: passwordHash,
              createdAt: now,
              updatedAt: now
            })
            .run();
        });
      } catch (error) {
        if (isSqliteConstraintError(error)) {
          return jsonResponse({ error: 'This faculty already has a secretary account or the email is already used.' }, { status: 409 });
        }
        throw error;
      }

      return jsonResponse(await buildAdminSecretaryResponse(), { status: 201 });
    },
    {
      body: t.Object({
        name: t.String(),
        email: t.String(),
        password: t.String(),
        facultyId: t.Number()
      })
    }
  )
  .patch(
    '/api/admin/secretaries/:id',
    async ({ body, params, request }) => {
      const authResult = await requireRole(request.headers, 'admin');
      if ('response' in authResult) return authResult.response;

      const secretary = await db.select().from(users).where(eq(users.id, params.id)).get();
      if (!secretary || secretary.role !== 'secretary') {
        return jsonResponse({ error: 'Secretary account not found.' }, { status: 404 });
      }

      const updates: Partial<typeof users.$inferInsert> = {};
      let password: string | null = null;

      if (body.name !== undefined) {
        const nameResult = validateRequiredText(body.name, 'Full name', textLimits.userName);
        if ('response' in nameResult) return nameResult.response;
        updates.name = nameResult.value;
      }

      if (body.email !== undefined) {
        const emailResult = validateUabEmail(body.email);
        if ('response' in emailResult) return emailResult.response;
        if (emailResult.value !== secretary.email) {
          const existingEmail = await db.select().from(users).where(eq(users.email, emailResult.value)).get();
          if (existingEmail) return jsonResponse({ error: 'An account with this email already exists.' }, { status: 409 });
          updates.email = emailResult.value;
        }
        updates.emailVerified = true;
      }

      if (body.password !== undefined && body.password.trim()) {
        const passwordResult = validatePassword(body.password);
        if ('response' in passwordResult) return passwordResult.response;
        password = passwordResult.value;
      }

      if (!Object.keys(updates).length && !password) {
        return jsonResponse({ error: 'No changes were provided.' }, { status: 400 });
      }

      const now = nowDate();
      if (Object.keys(updates).length) {
        updates.updatedAt = now;
        await db.update(users).set(updates).where(eq(users.id, secretary.id));
      }

      if (password) {
        await updateCredentialPassword(secretary.id, password, now);
      }

      return buildAdminSecretaryResponse();
    },
    {
      body: t.Object({
        name: t.Optional(t.String()),
        email: t.Optional(t.String()),
        password: t.Optional(t.String())
      })
    }
  )
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

      const nameResult = validateRequiredText(body.name, 'Full name', textLimits.userName);
      if ('response' in nameResult) return nameResult.response;
      const bioResult = validateOptionalText(body.bio, 'Bio', textLimits.profileBio);
      if ('response' in bioResult) return bioResult.response;

      const updates: Partial<typeof users.$inferInsert> = {
        name: nameResult.value,
        bio: bioResult.value,
        updatedAt: new Date()
      };

      if (body.officeLocation !== undefined) {
        const officeResult = validateOptionalText(body.officeLocation, 'Office location', textLimits.officeLocation);
        if ('response' in officeResult) return officeResult.response;
        updates.officeLocation = officeResult.value;
      }

      if (body.workingHours !== undefined) {
        const workingHoursResult = validateOptionalText(body.workingHours, 'Working hours', textLimits.workingHours);
        if ('response' in workingHoursResult) return workingHoursResult.response;
        updates.workingHours = workingHoursResult.value;
      }

      if (body.image !== undefined) {
        const imageResult = validateOptionalText(body.image, 'Profile image', 200000);
        if ('response' in imageResult) return imageResult.response;
        updates.image = imageResult.value || null;
      }

      await db
        .update(users)
        .set(updates)
        .where(eq(users.id, user.id));

      const updatedUser = await db.select().from(users).where(eq(users.id, user.id)).get();
      if (!updatedUser) return jsonResponse({ error: 'Profile could not be loaded.' }, { status: 500 });

      return buildProfileResponse(updatedUser);
    },
    {
      body: t.Object({
        name: t.String(),
        bio: t.String(),
        officeLocation: t.Optional(t.String()),
        workingHours: t.Optional(t.String()),
        image: t.Optional(t.String())
      })
    }
  )
  .get('/api/secretary/professors', async ({ request }) => {
    const authResult = await requireRole(request.headers, 'secretary');
    if ('response' in authResult) return authResult.response;

    return buildSecretaryProfessorResponse(authResult.user);
  })
  .post(
    '/api/secretary/professors',
    async ({ body, request }) => {
      const authResult = await requireRole(request.headers, 'secretary');
      if ('response' in authResult) return authResult.response;
      const facultyResult = await getSecretaryFaculty(authResult.user);
      if ('response' in facultyResult) return facultyResult.response;

      const nameResult = validateRequiredText(body.name, 'Full name', textLimits.userName);
      if ('response' in nameResult) return nameResult.response;
      const emailValidation = validateProfessorEmail(body.email);
      if (!emailValidation.ok) return jsonResponse({ error: emailValidation.error }, { status: 400 });
      const passwordResult = validatePassword(body.password);
      if ('response' in passwordResult) return passwordResult.response;
      const titleResult = validateOptionalText(body.academicTitle ?? '', 'Academic title', textLimits.academicTitle);
      if ('response' in titleResult) return titleResult.response;
      const officeResult = validateOptionalText(body.officeLocation ?? '', 'Office location', textLimits.officeLocation);
      if ('response' in officeResult) return officeResult.response;
      const workingHoursResult = validateOptionalText(body.workingHours ?? '', 'Working hours', textLimits.workingHours);
      if ('response' in workingHoursResult) return workingHoursResult.response;
      const bioResult = validateOptionalText(body.bio ?? '', 'Bio', textLimits.profileBio);
      if ('response' in bioResult) return bioResult.response;
      const specializationResult = await validateSecretarySpecializationIds(facultyResult.faculty.id, body.specializationIds);
      if ('response' in specializationResult) return specializationResult.response;

      const existingEmail = await db.select().from(users).where(eq(users.email, emailValidation.email)).get();
      if (existingEmail) return jsonResponse({ error: 'An account with this email already exists.' }, { status: 409 });

      const now = nowDate();
      const id = accountId();
      const passwordHash = await hashPassword(passwordResult.value);

      db.transaction((tx) => {
        tx.insert(users)
          .values({
            id,
            email: emailValidation.email,
            name: nameResult.value,
            bio: bioResult.value,
            role: 'professor',
            academicTitle: titleResult.value,
            officeLocation: officeResult.value,
            workingHours: workingHoursResult.value,
            isHidden: body.isHidden ?? false,
            facultyId: null,
            specializationId: null,
            isExtended: false,
            emailVerified: true,
            createdAt: now,
            updatedAt: now
          })
          .run();

        tx.insert(accounts)
          .values({
            id: accountId(),
            accountId: id,
            providerId: 'credential',
            userId: id,
            password: passwordHash,
            createdAt: now,
            updatedAt: now
          })
          .run();

        specializationResult.value.forEach((specializationId) => {
          tx.insert(professorSpecializations).values({ professorId: id, specializationId }).run();
        });
      });

      return jsonResponse(await buildSecretaryProfessorResponse(authResult.user), { status: 201 });
    },
    {
      body: t.Object({
        name: t.String(),
        email: t.String(),
        password: t.String(),
        academicTitle: t.Optional(t.String()),
        officeLocation: t.Optional(t.String()),
        workingHours: t.Optional(t.String()),
        bio: t.Optional(t.String()),
        specializationIds: t.Array(t.Number()),
        isHidden: t.Optional(t.Boolean())
      })
    }
  )
  .patch(
    '/api/secretary/professors/:id',
    async ({ body, params, request }) => {
      const authResult = await requireRole(request.headers, 'secretary');
      if ('response' in authResult) return authResult.response;
      const facultyResult = await getSecretaryFaculty(authResult.user);
      if ('response' in facultyResult) return facultyResult.response;

      const currentProfessors = await getSecretaryProfessorRows(facultyResult.faculty.id);
      const currentProfessor = currentProfessors.find((professor) => professor.id === params.id);
      if (!currentProfessor) return jsonResponse({ error: 'Professor not found in your faculty.' }, { status: 404 });

      const professor = await db.select().from(users).where(eq(users.id, params.id)).get();
      if (!professor || professor.role !== 'professor') return jsonResponse({ error: 'Professor not found.' }, { status: 404 });

      const updates: Partial<typeof users.$inferInsert> = { updatedAt: nowDate() };

      if (body.name !== undefined) {
        const nameResult = validateRequiredText(body.name, 'Full name', textLimits.userName);
        if ('response' in nameResult) return nameResult.response;
        updates.name = nameResult.value;
      }

      if (body.email !== undefined) {
        const emailValidation = validateProfessorEmail(body.email);
        if (!emailValidation.ok) return jsonResponse({ error: emailValidation.error }, { status: 400 });
        if (emailValidation.email !== professor.email) {
          const existingEmail = await db.select().from(users).where(eq(users.email, emailValidation.email)).get();
          if (existingEmail) return jsonResponse({ error: 'An account with this email already exists.' }, { status: 409 });
          updates.email = emailValidation.email;
        }
      }

      if (body.academicTitle !== undefined) {
        const titleResult = validateOptionalText(body.academicTitle, 'Academic title', textLimits.academicTitle);
        if ('response' in titleResult) return titleResult.response;
        updates.academicTitle = titleResult.value;
      }

      if (body.officeLocation !== undefined) {
        const officeResult = validateOptionalText(body.officeLocation, 'Office location', textLimits.officeLocation);
        if ('response' in officeResult) return officeResult.response;
        updates.officeLocation = officeResult.value;
      }

      if (body.workingHours !== undefined) {
        const workingHoursResult = validateOptionalText(body.workingHours, 'Working hours', textLimits.workingHours);
        if ('response' in workingHoursResult) return workingHoursResult.response;
        updates.workingHours = workingHoursResult.value;
      }

      if (body.bio !== undefined) {
        const bioResult = validateOptionalText(body.bio, 'Bio', textLimits.profileBio);
        if ('response' in bioResult) return bioResult.response;
        updates.bio = bioResult.value;
      }

      if (body.isHidden !== undefined) updates.isHidden = body.isHidden;

      let specializationIds: number[] | null = null;
      if (body.specializationIds !== undefined) {
        const specializationResult = await validateSecretarySpecializationIds(facultyResult.faculty.id, body.specializationIds);
        if ('response' in specializationResult) return specializationResult.response;
        specializationIds = specializationResult.value;
      }

      db.transaction((tx) => {
        tx.update(users).set(updates).where(eq(users.id, professor.id)).run();

        if (specializationIds) {
          const facultySpecializationIds = currentProfessor.specializations.map((specialization) => specialization.id);
          if (facultySpecializationIds.length) {
            tx.delete(professorSpecializations)
              .where(
                and(
                  eq(professorSpecializations.professorId, professor.id),
                  inArray(professorSpecializations.specializationId, facultySpecializationIds)
                )
              )
              .run();
          }

          specializationIds.forEach((specializationId) => {
            tx.insert(professorSpecializations).values({ professorId: professor.id, specializationId }).run();
          });
        }
      });

      return buildSecretaryProfessorResponse(authResult.user);
    },
    {
      body: t.Object({
        name: t.Optional(t.String()),
        email: t.Optional(t.String()),
        academicTitle: t.Optional(t.String()),
        officeLocation: t.Optional(t.String()),
        workingHours: t.Optional(t.String()),
        bio: t.Optional(t.String()),
        specializationIds: t.Optional(t.Array(t.Number())),
        isHidden: t.Optional(t.Boolean())
      })
    }
  )
  .get('/api/secretary/statistics', async ({ request }) => {
    const authResult = await requireRole(request.headers, 'secretary');
    if ('response' in authResult) return authResult.response;

    return buildSecretaryStatisticsResponse(authResult.user);
  })
  .get('/api/notifications', async ({ request }) => {
    const user = await getCurrentUser(request.headers);
    if (!user) return jsonResponse({ error: 'Not authenticated.' }, { status: 401 });

    const rows = await db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), eq(notifications.isCleared, false)))
      .orderBy(desc(notifications.createdAt));

    return { notifications: rows };
  })
  .post('/api/notifications/clear', async ({ request }) => {
    const user = await getCurrentUser(request.headers);
    if (!user) return jsonResponse({ error: 'Not authenticated.' }, { status: 401 });

    await db
      .update(notifications)
      .set({ isCleared: true })
      .where(and(eq(notifications.userId, user.id), eq(notifications.isCleared, false)));

    return { ok: true };
  })
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

      const titleResult = validateRequiredText(body.title, 'Title', textLimits.topicTitle);
      if ('response' in titleResult) return titleResult.response;
      const descriptionResult = validateRequiredText(body.description, 'Description', textLimits.topicDescription);
      if ('response' in descriptionResult) return descriptionResult.response;
      const specializationId = Number(body.specializationId);

      if (!(await hasProfessorSpecialization(authResult.user.id, specializationId))) {
        return jsonResponse({ error: 'This professor is not assigned to that specialisation.' }, { status: 403 });
      }

      const now = nowDate();
      const [created] = await db
        .insert(topics)
        .values({
          title: titleResult.value,
          description: descriptionResult.value,
          professorId: authResult.user.id,
          specializationId,
          origin: 'professor',
          status: 'available',
          createdAt: now,
          updatedAt: now
        })
        .returning();

      await notifyEligibleStudentsForTopic(created, authResult.user);

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

      if (
        topic.status !== 'available' &&
        (body.title !== undefined || body.description !== undefined || body.specializationId !== undefined)
      ) {
        return jsonResponse({ error: 'Only available topics can be edited.' }, { status: 400 });
      }

      const updates: Partial<typeof topics.$inferInsert> = { updatedAt: nowDate() };
      if (body.title !== undefined) {
        const titleResult = validateRequiredText(body.title, 'Title', textLimits.topicTitle);
        if ('response' in titleResult) return titleResult.response;
        updates.title = titleResult.value;
      }
      if (body.description !== undefined) {
        const descriptionResult = validateRequiredText(body.description, 'Description', textLimits.topicDescription);
        if ('response' in descriptionResult) return descriptionResult.response;
        updates.description = descriptionResult.value;
      }
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
  .delete('/api/professor/topics/:id', async ({ params, request }) => {
    const authResult = await requireRole(request.headers, 'professor');
    if ('response' in authResult) return authResult.response;

    const topicId = Number(params.id);
    const topic = await db.select().from(topics).where(eq(topics.id, topicId)).get();
    if (!topic || topic.professorId !== authResult.user.id) {
      return jsonResponse({ error: 'Topic not found.' }, { status: 404 });
    }
    if (topic.origin !== 'professor' || topic.status !== 'available') {
      return jsonResponse({ error: 'Only available professor topics can be deleted.' }, { status: 400 });
    }

    const assignmentRows = await db
      .select({ id: topicAssignments.id })
      .from(topicAssignments)
      .where(eq(topicAssignments.topicId, topicId));
    const assignmentIds = assignmentRows.map((assignment) => assignment.id);

    if (assignmentIds.length) {
      await db.delete(topicChangeRequests).where(inArray(topicChangeRequests.assignmentId, assignmentIds));
      await db.delete(topicAssignments).where(eq(topicAssignments.topicId, topicId));
    }

    await db.delete(topicRequests).where(eq(topicRequests.topicId, topicId));
    await db.delete(topics).where(eq(topics.id, topicId));
    return { ok: true };
  })
  .post('/api/professor/requests/:id/accept', async ({ params, request }) => {
    const authResult = await requireRole(request.headers, 'professor');
    if ('response' in authResult) return authResult.response;

    await expirePendingLifecycleItems();
    const requestId = Number(params.id);
    const now = nowDate();

    try {
      const result = db.transaction((tx) => {
        const topicRequest = tx.select().from(topicRequests).where(eq(topicRequests.id, requestId)).get();
        if (!topicRequest || topicRequest.professorId !== authResult.user.id) {
          return { response: jsonResponse({ error: 'Request not found.' }, { status: 404 }) };
        }
        if (topicRequest.status !== 'pending') {
          return { response: jsonResponse({ error: 'Only pending requests can be accepted.' }, { status: 400 }) };
        }

        const activeAssignment = tx
          .select()
          .from(topicAssignments)
          .where(and(eq(topicAssignments.studentId, topicRequest.studentId), eq(topicAssignments.status, 'active')))
          .get();
        if (activeAssignment) {
          return { response: jsonResponse({ error: 'This student already has an active assignment.' }, { status: 409 }) };
        }

        let acceptedTopic: typeof topics.$inferSelect | undefined;

        if (topicRequest.type === 'topic_claim') {
          if (!topicRequest.topicId) return { response: jsonResponse({ error: 'Topic claim is missing a topic.' }, { status: 400 }) };

          const updatedTopic = tx
            .update(topics)
            .set({ status: 'inactive', updatedAt: now })
            .where(
              and(
                eq(topics.id, topicRequest.topicId),
                eq(topics.professorId, authResult.user.id),
                eq(topics.status, 'reserved')
              )
            )
            .returning()
            .get();
          if (!updatedTopic) {
            return { response: jsonResponse({ error: 'Topic is not reserved by this request.' }, { status: 409 }) };
          }
          acceptedTopic = updatedTopic;
        } else {
          const student = tx.select().from(users).where(eq(users.id, topicRequest.studentId)).get();
          if (!student?.specializationId) {
            return { response: jsonResponse({ error: 'Student specialisation could not be found.' }, { status: 400 }) };
          }

          const professorAssignment = tx
            .select()
            .from(professorSpecializations)
            .where(
              and(
                eq(professorSpecializations.professorId, authResult.user.id),
                eq(professorSpecializations.specializationId, student.specializationId)
              )
            )
            .get();
          if (!professorAssignment) {
            return { response: jsonResponse({ error: 'This professor is not assigned to the student specialisation.' }, { status: 403 }) };
          }

          const createdTopic = tx
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
            .returning()
            .get();
          acceptedTopic = createdTopic;
        }

        if (!acceptedTopic) return { response: jsonResponse({ error: 'Topic could not be accepted.' }, { status: 500 }) };

        const assignment = tx
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
          .returning()
          .get();

        const acceptedRequest = tx
          .update(topicRequests)
          .set({ status: 'accepted', updatedAt: now })
          .where(and(eq(topicRequests.id, requestId), eq(topicRequests.status, 'pending')))
          .returning()
          .get();
        if (!acceptedRequest) {
          return { response: jsonResponse({ error: 'Only pending requests can be accepted.' }, { status: 400 }) };
        }

        return { assignment, acceptedTopic, topicRequest };
      });

      if ('response' in result) return result.response;

      await createNotification({
        userId: result.topicRequest.studentId,
        actorId: authResult.user.id,
        type: 'topic_request_accepted',
        title: result.topicRequest.type === 'custom_proposal' ? 'Custom proposal accepted' : 'Topic claim accepted',
        message: `${authResult.user.name} accepted "${result.acceptedTopic.title}".`,
        entityType: 'topic_request',
        entityId: result.topicRequest.id,
        topicTitle: result.acceptedTopic.title,
        createdAt: now
      });

      return { assignment: result.assignment };
    } catch (error) {
      if (isSqliteConstraintError(error)) {
        return jsonResponse({ error: 'This student already has an active assignment.' }, { status: 409 });
      }
      throw error;
    }
  })
  .post('/api/professor/requests/:id/reject', async ({ params, request }) => {
    const authResult = await requireRole(request.headers, 'professor');
    if ('response' in authResult) return authResult.response;

    await expirePendingLifecycleItems();
    const requestId = Number(params.id);
    const now = nowDate();
    const result = db.transaction((tx) => {
      const topicRequest = tx.select().from(topicRequests).where(eq(topicRequests.id, requestId)).get();
      if (!topicRequest || topicRequest.professorId !== authResult.user.id) {
        return { response: jsonResponse({ error: 'Request not found.' }, { status: 404 }) };
      }
      if (topicRequest.status !== 'pending') {
        return { response: jsonResponse({ error: 'Only pending requests can be rejected.' }, { status: 400 }) };
      }

      const topic =
        topicRequest.topicId !== null ? tx.select().from(topics).where(eq(topics.id, topicRequest.topicId)).get() : null;
      const title = topicRequest.customTitle ?? topic?.title ?? 'requested topic';

      const rejectedRequest = tx
        .update(topicRequests)
        .set({ status: 'rejected', updatedAt: now })
        .where(and(eq(topicRequests.id, requestId), eq(topicRequests.status, 'pending')))
        .returning()
        .get();
      if (!rejectedRequest) {
        return { response: jsonResponse({ error: 'Only pending requests can be rejected.' }, { status: 400 }) };
      }

      if (topicRequest.type === 'topic_claim' && topicRequest.topicId) {
        tx.update(topics)
          .set({ status: 'available', updatedAt: now })
          .where(and(eq(topics.id, topicRequest.topicId), eq(topics.status, 'reserved')))
          .run();
      }

      return { topicRequest, title };
    });

    if ('response' in result) return result.response;

    await createNotification({
      userId: result.topicRequest.studentId,
      actorId: authResult.user.id,
      type: 'topic_request_rejected',
      title: result.topicRequest.type === 'custom_proposal' ? 'Custom proposal rejected' : 'Topic claim rejected',
      message: `${authResult.user.name} rejected "${result.title}".`,
      entityType: 'topic_request',
      entityId: result.topicRequest.id,
      topicTitle: result.title,
      createdAt: now
    });

    return { ok: true };
  })
  .get('/api/professor/change-requests', async ({ request }) => {
    const authResult = await requireRole(request.headers, 'professor');
    if ('response' in authResult) return authResult.response;

    await expirePendingChangeRequests();
    const rows = await db
      .select({
        id: topicChangeRequests.id,
        assignmentId: topicChangeRequests.assignmentId,
        studentId: topicChangeRequests.studentId,
        professorId: topicChangeRequests.professorId,
        requestedTitle: topicChangeRequests.requestedTitle,
        requestedDescription: topicChangeRequests.requestedDescription,
        status: topicChangeRequests.status,
        expiresAt: topicChangeRequests.expiresAt,
        createdAt: topicChangeRequests.createdAt,
        updatedAt: topicChangeRequests.updatedAt,
        currentTitle: topicAssignments.title,
        currentDescription: topicAssignments.description,
        studentName: users.name,
        topicOrigin: topics.origin,
        specialization: specializations.name,
        faculty: faculties.name
      })
      .from(topicChangeRequests)
      .innerJoin(topicAssignments, eq(topicChangeRequests.assignmentId, topicAssignments.id))
      .innerJoin(users, eq(topicChangeRequests.studentId, users.id))
      .innerJoin(topics, eq(topicAssignments.topicId, topics.id))
      .innerJoin(specializations, eq(topics.specializationId, specializations.id))
      .innerJoin(faculties, eq(specializations.facultyId, faculties.id))
      .where(and(eq(topicChangeRequests.professorId, authResult.user.id), eq(topicChangeRequests.status, 'pending')));
    return { changeRequests: rows };
  })
  .get('/api/professor/request-history', async ({ request }) => {
    const authResult = await requireRole(request.headers, 'professor');
    if ('response' in authResult) return authResult.response;

    const topicHistory = await buildTopicRequestRows(
      and(
        eq(topicRequests.professorId, authResult.user.id),
        or(eq(topicRequests.status, 'accepted'), eq(topicRequests.status, 'rejected'))
      )
    );

    const changeHistory = await db
      .select({
        id: topicChangeRequests.id,
        status: topicChangeRequests.status,
        updatedAt: topicChangeRequests.updatedAt,
        createdAt: topicChangeRequests.createdAt,
        requestedTitle: topicChangeRequests.requestedTitle,
        currentTitle: topicAssignments.title,
        studentName: users.name,
        specialization: specializations.name,
        faculty: faculties.name
      })
      .from(topicChangeRequests)
      .innerJoin(topicAssignments, eq(topicChangeRequests.assignmentId, topicAssignments.id))
      .innerJoin(users, eq(topicChangeRequests.studentId, users.id))
      .innerJoin(topics, eq(topicAssignments.topicId, topics.id))
      .innerJoin(specializations, eq(topics.specializationId, specializations.id))
      .innerJoin(faculties, eq(specializations.facultyId, faculties.id))
      .where(
        and(
          eq(topicChangeRequests.professorId, authResult.user.id),
          or(eq(topicChangeRequests.status, 'accepted'), eq(topicChangeRequests.status, 'rejected'))
        )
      );

    const normalizedTopicHistory = topicHistory.map((item) => ({
      id: item.id,
      kind: item.type,
      status: item.status,
      studentName: item.studentName,
      title: item.title,
      requestType: item.type === 'topic_claim' ? 'Topic claim' : 'Custom proposal',
      updatedAt: item.updatedAt,
      createdAt: item.createdAt
    }));

    const normalizedChangeHistory = changeHistory.map((item) => ({
      id: item.id,
      kind: 'change_request',
      status: item.status,
      studentName: item.studentName,
      title: item.status === 'accepted' ? item.requestedTitle : item.currentTitle,
      requestType: 'Edit request',
      faculty: item.faculty,
      specialization: item.specialization,
      updatedAt: item.updatedAt,
      createdAt: item.createdAt
    }));

    const allHistory = [...normalizedTopicHistory, ...normalizedChangeHistory].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    return {
      approved: allHistory.filter((item) => item.status === 'accepted'),
      rejected: allHistory.filter((item) => item.status === 'rejected')
    };
  })
  .post('/api/professor/change-requests/:id/accept', async ({ params, request }) => {
    const authResult = await requireRole(request.headers, 'professor');
    if ('response' in authResult) return authResult.response;

    await expirePendingChangeRequests();
    const id = Number(params.id);
    const now = nowDate();
    const result = db.transaction((tx) => {
      const changeRequest = tx.select().from(topicChangeRequests).where(eq(topicChangeRequests.id, id)).get();
      if (!changeRequest || changeRequest.professorId !== authResult.user.id) {
        return { response: jsonResponse({ error: 'Change request not found.' }, { status: 404 }) };
      }
      if (changeRequest.status !== 'pending') {
        return { response: jsonResponse({ error: 'Only pending change requests can be accepted.' }, { status: 400 }) };
      }

      const assignment = tx.select().from(topicAssignments).where(eq(topicAssignments.id, changeRequest.assignmentId)).get();
      if (!assignment || assignment.status !== 'active') {
        return { response: jsonResponse({ error: 'Assignment is no longer active.' }, { status: 409 }) };
      }

      const updatedAssignment = tx
        .update(topicAssignments)
        .set({
          title: changeRequest.requestedTitle,
          description: changeRequest.requestedDescription,
          updatedAt: now
        })
        .where(and(eq(topicAssignments.id, changeRequest.assignmentId), eq(topicAssignments.status, 'active')))
        .returning()
        .get();
      if (!updatedAssignment) {
        return { response: jsonResponse({ error: 'Assignment is no longer active.' }, { status: 409 }) };
      }

      const acceptedRequest = tx
        .update(topicChangeRequests)
        .set({ status: 'accepted', updatedAt: now })
        .where(and(eq(topicChangeRequests.id, id), eq(topicChangeRequests.status, 'pending')))
        .returning()
        .get();
      if (!acceptedRequest) {
        return { response: jsonResponse({ error: 'Only pending change requests can be accepted.' }, { status: 400 }) };
      }

      return { changeRequest, assignment };
    });

    if ('response' in result) return result.response;

    await createNotification({
      userId: result.changeRequest.studentId,
      actorId: authResult.user.id,
      type: 'edit_request_accepted',
      title: 'Edit request accepted',
      message: `${authResult.user.name} accepted changes to "${result.assignment.title}".`,
      entityType: 'topic_change_request',
      entityId: result.changeRequest.id,
      topicTitle: result.assignment.title,
      createdAt: now
    });
    return { ok: true };
  })
  .post('/api/professor/change-requests/:id/reject', async ({ params, request }) => {
    const authResult = await requireRole(request.headers, 'professor');
    if ('response' in authResult) return authResult.response;

    await expirePendingChangeRequests();
    const id = Number(params.id);
    const now = nowDate();
    const result = db.transaction((tx) => {
      const changeRequest = tx.select().from(topicChangeRequests).where(eq(topicChangeRequests.id, id)).get();
      if (!changeRequest || changeRequest.professorId !== authResult.user.id) {
        return { response: jsonResponse({ error: 'Change request not found.' }, { status: 404 }) };
      }
      if (changeRequest.status !== 'pending') {
        return { response: jsonResponse({ error: 'Only pending change requests can be rejected.' }, { status: 400 }) };
      }

      const assignment = tx.select().from(topicAssignments).where(eq(topicAssignments.id, changeRequest.assignmentId)).get();
      const rejectedRequest = tx
        .update(topicChangeRequests)
        .set({ status: 'rejected', updatedAt: now })
        .where(and(eq(topicChangeRequests.id, id), eq(topicChangeRequests.status, 'pending')))
        .returning()
        .get();
      if (!rejectedRequest) {
        return { response: jsonResponse({ error: 'Only pending change requests can be rejected.' }, { status: 400 }) };
      }

      return { changeRequest, assignment };
    });

    if ('response' in result) return result.response;

    await createNotification({
      userId: result.changeRequest.studentId,
      actorId: authResult.user.id,
      type: 'edit_request_rejected',
      title: 'Edit request rejected',
      message: `${authResult.user.name} rejected changes to "${result.assignment?.title ?? result.changeRequest.requestedTitle}".`,
      entityType: 'topic_change_request',
      entityId: result.changeRequest.id,
      topicTitle: result.assignment?.title ?? result.changeRequest.requestedTitle,
      createdAt: now
    });
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
    const rows = await buildTopicRequestRows(
      and(eq(topicRequests.studentId, authResult.user.id), eq(topicRequests.studentHidden, false))
    );
    return { requests: rows };
  })
  .get('/api/student/assignment', async ({ request }) => {
    const authResult = await requireRole(request.headers, 'student');
    if ('response' in authResult) return authResult.response;

    await expirePendingLifecycleItems();
    await expirePendingChangeRequests();
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

    if (!row) return { assignment: null };

    const pendingChangeRequest = await db
      .select()
      .from(topicChangeRequests)
      .where(and(eq(topicChangeRequests.assignmentId, row.id), eq(topicChangeRequests.status, 'pending')))
      .get();

    return {
      assignment: {
        ...row,
        summary: summarizeWords(row.description),
        pendingChangeRequest: pendingChangeRequest
          ? {
              id: pendingChangeRequest.id,
              requestedTitle: pendingChangeRequest.requestedTitle,
              requestedDescription: pendingChangeRequest.requestedDescription,
              expiresAt: pendingChangeRequest.expiresAt
            }
          : null
      }
    };
  })
  .post(
    '/api/student/topic-requests',
    async ({ body, request }) => {
      const authResult = await requireRole(request.headers, 'student');
      if ('response' in authResult) return authResult.response;

      await expirePendingLifecycleItems();
      const student = authResult.user;
      const topicId = Number(body.topicId);
      const now = nowDate();

      try {
        const result = db.transaction((tx) => {
          const pending = tx
            .select()
            .from(topicRequests)
            .where(and(eq(topicRequests.studentId, student.id), eq(topicRequests.status, 'pending')))
            .get();
          if (pending) return { response: jsonResponse({ error: 'You already have a pending request.' }, { status: 409 }) };

          const activeAssignment = tx
            .select()
            .from(topicAssignments)
            .where(and(eq(topicAssignments.studentId, student.id), eq(topicAssignments.status, 'active')))
            .get();
          if (activeAssignment) {
            return { response: jsonResponse({ error: 'You already have an active assignment.' }, { status: 409 }) };
          }

          const topic = tx.select().from(topics).where(eq(topics.id, topicId)).get();
          if (!topic || topic.origin !== 'professor' || topic.specializationId !== student.specializationId) {
            return { response: jsonResponse({ error: 'Topic not found.' }, { status: 404 }) };
          }

          const reservedTopic = tx
            .update(topics)
            .set({ status: 'reserved', updatedAt: now })
            .where(and(eq(topics.id, topic.id), eq(topics.status, 'available')))
            .returning()
            .get();
          if (!reservedTopic) {
            return { response: jsonResponse({ error: 'This topic is not available.' }, { status: 409 }) };
          }

          const created = tx
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
            .returning()
            .get();

          return { created, topic };
        });

        if ('response' in result) return result.response;

        await createNotification({
          userId: result.topic.professorId,
          actorId: student.id,
          type: 'topic_claim_received',
          title: 'New topic claim',
          message: `${student.name} requested "${result.topic.title}".`,
          entityType: 'topic_request',
          entityId: result.created.id,
          topicTitle: result.topic.title,
          createdAt: now
        });

        return jsonResponse({ request: result.created }, { status: 201 });
      } catch (error) {
        if (isSqliteConstraintError(error)) {
          return jsonResponse({ error: 'You already have a pending request or this topic is no longer available.' }, { status: 409 });
        }
        throw error;
      }
    },
    {
      body: t.Object({
        topicId: t.Number()
      })
    }
  )
  .post('/api/student/requests/:id/dismiss', async ({ params, request }) => {
    const authResult = await requireRole(request.headers, 'student');
    if ('response' in authResult) return authResult.response;

    const requestId = Number(params.id);
    const topicRequest = await db.select().from(topicRequests).where(eq(topicRequests.id, requestId)).get();
    if (!topicRequest || topicRequest.studentId !== authResult.user.id) {
      return jsonResponse({ error: 'Request not found.' }, { status: 404 });
    }
    if (!['accepted', 'rejected', 'expired', 'cancelled'].includes(topicRequest.status)) {
      return jsonResponse({ error: 'Only completed or expired requests can be removed from the dashboard.' }, { status: 400 });
    }

    await db.update(topicRequests).set({ studentHidden: true }).where(eq(topicRequests.id, requestId));
    return { ok: true };
  })
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
      const studentSpecializationId = student.specializationId;

      const professorId = body.professorId.trim();
      const now = nowDate();
      const titleResult = validateRequiredText(body.title, 'Title', textLimits.topicTitle);
      if ('response' in titleResult) return titleResult.response;
      const descriptionResult = validateRequiredText(body.description, 'Description', textLimits.topicDescription);
      if ('response' in descriptionResult) return descriptionResult.response;

      try {
        const result = db.transaction((tx) => {
          const pending = tx
            .select()
            .from(topicRequests)
            .where(and(eq(topicRequests.studentId, student.id), eq(topicRequests.status, 'pending')))
            .get();
          if (pending) return { response: jsonResponse({ error: 'You already have a pending request.' }, { status: 409 }) };

          const activeAssignment = tx
            .select()
            .from(topicAssignments)
            .where(and(eq(topicAssignments.studentId, student.id), eq(topicAssignments.status, 'active')))
            .get();
          if (activeAssignment) {
            return { response: jsonResponse({ error: 'You already have an active assignment.' }, { status: 409 }) };
          }

          const professor = tx.select().from(users).where(eq(users.id, professorId)).get();
          if (!professor || professor.role !== 'professor') {
            return { response: jsonResponse({ error: 'Professor not found.' }, { status: 404 }) };
          }

          const professorAssignment = tx
            .select()
            .from(professorSpecializations)
            .where(
              and(
                eq(professorSpecializations.professorId, professorId),
                eq(professorSpecializations.specializationId, studentSpecializationId)
              )
            )
            .get();
          if (!professorAssignment) {
            return { response: jsonResponse({ error: 'Professor is not assigned to your specialisation.' }, { status: 403 }) };
          }

          const created = tx
            .insert(topicRequests)
            .values({
              studentId: student.id,
              professorId,
              type: 'custom_proposal',
              customTitle: titleResult.value,
              customDescription: descriptionResult.value,
              status: 'pending',
              expiresAt: addMs(now, requestLifetimeMs),
              createdAt: now,
              updatedAt: now
            })
            .returning()
            .get();

          return { created };
        });

        if ('response' in result) return result.response;

        await createNotification({
          userId: professorId,
          actorId: student.id,
          type: 'custom_proposal_received',
          title: 'New custom proposal',
          message: `${student.name} proposed "${titleResult.value}".`,
          entityType: 'topic_request',
          entityId: result.created.id,
          topicTitle: titleResult.value,
          createdAt: now
        });

        return jsonResponse({ request: result.created }, { status: 201 });
      } catch (error) {
        if (isSqliteConstraintError(error)) {
          return jsonResponse({ error: 'You already have a pending request.' }, { status: 409 });
        }
        throw error;
      }
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
    const now = nowDate();
    const result = db.transaction((tx) => {
      const assignment = tx.select().from(topicAssignments).where(eq(topicAssignments.id, assignmentId)).get();
      if (!assignment || assignment.studentId !== authResult.user.id) {
        return { response: jsonResponse({ error: 'Assignment not found.' }, { status: 404 }) };
      }
      if (assignment.status !== 'active') {
        return { response: jsonResponse({ error: 'Only active assignments can be abandoned.' }, { status: 400 }) };
      }

      const topic = tx.select().from(topics).where(eq(topics.id, assignment.topicId)).get();
      const abandonedAssignment = tx
        .update(topicAssignments)
        .set({ status: 'abandoned', updatedAt: now })
        .where(and(eq(topicAssignments.id, assignment.id), eq(topicAssignments.status, 'active')))
        .returning()
        .get();
      if (!abandonedAssignment) {
        return { response: jsonResponse({ error: 'Only active assignments can be abandoned.' }, { status: 400 }) };
      }

      if (topic?.origin === 'professor') {
        tx.update(topics).set({ status: 'available', updatedAt: now }).where(eq(topics.id, topic.id)).run();
      }

      tx.update(topicChangeRequests)
        .set({ status: 'cancelled', updatedAt: now })
        .where(and(eq(topicChangeRequests.assignmentId, assignment.id), eq(topicChangeRequests.status, 'pending')))
        .run();

      return { assignment };
    });

    if ('response' in result) return result.response;

    await createNotification({
      userId: result.assignment.professorId,
      actorId: authResult.user.id,
      type: 'student_assignment_dropped',
      title: 'Assignment dropped',
      message: `${authResult.user.name} dropped "${result.assignment.title}".`,
      entityType: 'assignment',
      entityId: result.assignment.id,
      topicTitle: result.assignment.title,
      createdAt: now
    });

    return { ok: true };
  })
  .post(
    '/api/student/assignments/:id/change-requests',
    async ({ body, params, request }) => {
      const authResult = await requireRole(request.headers, 'student');
      if ('response' in authResult) return authResult.response;

      await expirePendingChangeRequests();
      const assignmentId = Number(params.id);
      const now = nowDate();
      const requestedTitleResult = validateRequiredText(body.title, 'Title', textLimits.topicTitle);
      if ('response' in requestedTitleResult) return requestedTitleResult.response;
      const requestedDescriptionResult = validateRequiredText(body.description, 'Description', textLimits.topicDescription);
      if ('response' in requestedDescriptionResult) return requestedDescriptionResult.response;

      try {
        const result = db.transaction((tx) => {
          const assignment = tx.select().from(topicAssignments).where(eq(topicAssignments.id, assignmentId)).get();
          if (!assignment || assignment.studentId !== authResult.user.id || assignment.status !== 'active') {
            return { response: jsonResponse({ error: 'Assignment not found.' }, { status: 404 }) };
          }

          const existing = tx
            .select()
            .from(topicChangeRequests)
            .where(and(eq(topicChangeRequests.assignmentId, assignment.id), eq(topicChangeRequests.status, 'pending')))
            .get();
          if (existing) {
            return { response: jsonResponse({ error: 'This assignment already has a pending change request.' }, { status: 409 }) };
          }

          const created = tx
            .insert(topicChangeRequests)
            .values({
              assignmentId: assignment.id,
              studentId: authResult.user.id,
              professorId: assignment.professorId,
              requestedTitle: requestedTitleResult.value,
              requestedDescription: requestedDescriptionResult.value,
              status: 'pending',
              expiresAt: addMs(now, changeRequestLifetimeMs),
              createdAt: now,
              updatedAt: now
            })
            .returning()
            .get();

          return { created, assignment };
        });

        if ('response' in result) return result.response;

        await createNotification({
          userId: result.assignment.professorId,
          actorId: authResult.user.id,
          type: 'edit_request_received',
          title: 'New edit request',
          message: `${authResult.user.name} requested changes to "${result.assignment.title}".`,
          entityType: 'topic_change_request',
          entityId: result.created.id,
          topicTitle: result.assignment.title,
          createdAt: now
        });

        return jsonResponse({ changeRequest: result.created }, { status: 201 });
      } catch (error) {
        if (isSqliteConstraintError(error)) {
          return jsonResponse({ error: 'This assignment already has a pending change request.' }, { status: 409 });
        }
        throw error;
      }
    },
    {
      body: t.Object({
        title: t.String(),
        description: t.String()
      })
    }
  )
  .listen(3000);
