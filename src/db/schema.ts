import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const faculties = sqliteTable('faculties', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull()
});

export const specializations = sqliteTable('specializations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  facultyId: integer('faculty_id').notNull().references(() => faculties.id)
});

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  bio: text('bio').notNull().default(''),
  role: text('role').notNull(),
  facultyId: integer('faculty_id').references(() => faculties.id),
  specializationId: integer('specialization_id').references(() => specializations.id),
  isExtended: integer('is_extended', { mode: 'boolean' }).default(false),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
});

export const professorSpecializations = sqliteTable(
  'professor_specializations',
  {
    professorId: text('professor_id')
      .notNull()
      .references(() => users.id),
    specializationId: integer('specialization_id')
      .notNull()
      .references(() => specializations.id)
  },
  (table) => ({
    assignment: uniqueIndex('professor_specializations_assignment_unique').on(
      table.professorId,
      table.specializationId
    )
  })
);

export const topics = sqliteTable('topics', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  description: text('description').notNull(),
  professorId: text('professor_id')
    .notNull()
    .references(() => users.id),
  specializationId: integer('specialization_id')
    .notNull()
    .references(() => specializations.id),
  origin: text('origin').notNull(),
  status: text('status').notNull().default('available'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
});

export const topicRequests = sqliteTable('topic_requests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  studentId: text('student_id')
    .notNull()
    .references(() => users.id),
  professorId: text('professor_id')
    .notNull()
    .references(() => users.id),
  topicId: integer('topic_id').references(() => topics.id),
  type: text('type').notNull(),
  customTitle: text('custom_title'),
  customDescription: text('custom_description'),
  status: text('status').notNull().default('pending'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
});

export const topicAssignments = sqliteTable('topic_assignments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  studentId: text('student_id')
    .notNull()
    .references(() => users.id),
  professorId: text('professor_id')
    .notNull()
    .references(() => users.id),
  topicId: integer('topic_id')
    .notNull()
    .references(() => topics.id),
  title: text('title').notNull(),
  description: text('description').notNull(),
  status: text('status').notNull().default('active'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
});

export const topicChangeRequests = sqliteTable('topic_change_requests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  assignmentId: integer('assignment_id')
    .notNull()
    .references(() => topicAssignments.id),
  studentId: text('student_id')
    .notNull()
    .references(() => users.id),
  professorId: text('professor_id')
    .notNull()
    .references(() => users.id),
  requestedTitle: text('requested_title').notNull(),
  requestedDescription: text('requested_description').notNull(),
  status: text('status').notNull().default('pending'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => users.id)
});

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => users.id),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
});

export const verifications = sqliteTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
});
