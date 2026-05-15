import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

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
  role: text('role').notNull(),
  facultyId: integer('faculty_id').references(() => faculties.id),
  specializationId: integer('specialization_id').references(() => specializations.id),
  isExtended: integer('is_extended', { mode: 'boolean' }).default(false),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
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

export const professorSpecializations = sqliteTable('professor_specializations', {
  professorId: text('professor_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  specializationId: integer('specialization_id').notNull().references(() => specializations.id, { onDelete: 'cascade' })
}, (table) => [
  primaryKey({ columns: [table.professorId, table.specializationId] })
]);

export const topics = sqliteTable('topics', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  title: text('title').notNull(),
  description: text('description'),
  professorId: text('professor_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  specializationId: integer('specialization_id').notNull().references(() => specializations.id, { onDelete: 'cascade' }),
  origin: text('origin').notNull().default('professor'),
  status: text('status').notNull().default('available'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
});

export const topicRequests = sqliteTable('topic_requests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  studentId: text('student_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  professorId: text('professor_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  topicId: integer('topic_id').references(() => topics.id, { onDelete: 'set null' }),
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
  studentId: text('student_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  professorId: text('professor_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  topicId: integer('topic_id').notNull().references(() => topics.id, { onDelete: 'cascade' }),
  requestId: integer('request_id').references(() => topicRequests.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('active'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  abandonedAt: integer('abandoned_at', { mode: 'timestamp' })
});

export const topicChangeRequests = sqliteTable('topic_change_requests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  assignmentId: integer('assignment_id').notNull().references(() => topicAssignments.id, { onDelete: 'cascade' }),
  studentId: text('student_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  professorId: text('professor_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  proposedTitle: text('proposed_title').notNull(),
  proposedDescription: text('proposed_description'),
  status: text('status').notNull().default('pending'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
});

export const notifications = sqliteTable('notifications', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  link: text('link'),
  isRead: integer('is_read', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
});
