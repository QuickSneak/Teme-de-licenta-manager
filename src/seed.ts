import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { eq } from 'drizzle-orm';
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
  users,
  verifications
} from './db/schema';
import { ensureAcademicUnit, specialtyMappings } from './uab';

const seedAuth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET ?? 'dev-secret-change-before-production',
  baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000/api/auth',
  database: drizzleAdapter(db, {
    provider: 'sqlite',
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
      users,
      sessions,
      accounts,
      verifications
    }
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false
  },
  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: true
      },
      facultyId: {
        type: 'number',
        required: false
      },
      specializationId: {
        type: 'number',
        required: false
      },
      isExtended: {
        type: 'boolean',
        required: false,
        defaultValue: false
      }
    }
  }
});

async function createUser(input: {
  name: string;
  email: string;
  password: string;
  role: 'student' | 'professor' | 'secretary';
  facultyId?: number;
  specializationId?: number;
}) {
  await seedAuth.api.signUpEmail({
    body: {
      name: input.name,
      email: input.email,
      password: input.password,
      role: input.role,
      facultyId: input.facultyId,
      specializationId: input.specializationId,
      isExtended: false
    }
  });

  await db.update(users).set({ emailVerified: true }).where(eq(users.email, input.email));
  const user = await db.select().from(users).where(eq(users.email, input.email)).get();
  if (!user) throw new Error(`Failed to create user ${input.email}`);
  return user;
}

async function seed() {
  await db.delete(topicChangeRequests);
  await db.delete(notifications);
  await db.delete(topicAssignments);
  await db.delete(topicRequests);
  await db.delete(topics);
  await db.delete(professorSpecializations);
  await db.delete(sessions);
  await db.delete(verifications);
  await db.delete(accounts);
  await db.delete(users);
  await db.delete(specializations);
  await db.delete(faculties);

  const info = await ensureAcademicUnit(specialtyMappings.info);
  const infoEn = await ensureAcademicUnit(specialtyMappings.infoen);
  const marketing = await ensureAcademicUnit(specialtyMappings.mk);

  const student = await createUser({
    name: 'Test Student',
    email: 'student.test.info23@uab.ro',
    password: 'password123',
    role: 'student',
    facultyId: info.faculty.id,
    specializationId: info.specialization.id
  });

  const secondStudent = await createUser({
    name: 'Lifecycle Student',
    email: 'lifecycle.student.info23@uab.ro',
    password: 'password123',
    role: 'student',
    facultyId: info.faculty.id,
    specializationId: info.specialization.id
  });

  const marketingStudent = await createUser({
    name: 'Marketing Student',
    email: 'student.marketing.mk23@uab.ro',
    password: 'password123',
    role: 'student',
    facultyId: marketing.faculty.id,
    specializationId: marketing.specialization.id
  });

  const professor = await createUser({
    name: 'Test Professor',
    email: 'professor.test@uab.ro',
    password: 'password123',
    role: 'professor'
  });

  const elena = await createUser({
    name: 'Elena Popescu',
    email: 'elena.popescu@uab.ro',
    password: 'password123',
    role: 'professor'
  });

  const radu = await createUser({
    name: 'Radu Mihai',
    email: 'radu.mihai@uab.ro',
    password: 'password123',
    role: 'professor'
  });

  await createUser({
    name: 'Test Secretary',
    email: 'secretary.marketing@uab.ro',
    password: 'password123',
    role: 'secretary',
    facultyId: marketing.faculty.id
  });

  const now = new Date();
  const expiredAt = new Date(now.getTime() - 60 * 60 * 1000);
  const in72Hours = new Date(now.getTime() + 72 * 60 * 60 * 1000);

  await db.insert(professorSpecializations).values([
    { professorId: professor.id, specializationId: info.specialization.id },
    { professorId: professor.id, specializationId: infoEn.specialization.id },
    { professorId: professor.id, specializationId: marketing.specialization.id },
    { professorId: elena.id, specializationId: info.specialization.id },
    { professorId: elena.id, specializationId: infoEn.specialization.id },
    { professorId: radu.id, specializationId: info.specialization.id },
    { professorId: radu.id, specializationId: marketing.specialization.id }
  ]);

  const insertedTopics = await db
    .insert(topics)
    .values([
      {
        title: 'Web App for Thesis Management',
        description: 'Build a web application to manage thesis topics, requests, assignments, and professor coordination.',
        professorId: professor.id,
        specializationId: info.specialization.id,
        origin: 'professor',
        status: 'available',
        createdAt: now,
        updatedAt: now
      },
      {
        title: 'Data Security in IoT Networks',
        description: 'Explore IoT communication risks and design a secure monitoring framework.',
        professorId: elena.id,
        specializationId: info.specialization.id,
        origin: 'professor',
        status: 'available',
        createdAt: now,
        updatedAt: now
      },
      {
        title: 'AI-Based Scheduling Assistant',
        description: 'Create an assistant that optimizes academic scheduling using AI techniques.',
        professorId: radu.id,
        specializationId: info.specialization.id,
        origin: 'professor',
        status: 'reserved',
        createdAt: now,
        updatedAt: now
      },
      {
        title: 'Business Analytics Dashboard for SMEs',
        description: 'Design a dashboard for marketing and business performance indicators in small companies.',
        professorId: professor.id,
        specializationId: marketing.specialization.id,
        origin: 'professor',
        status: 'available',
        createdAt: now,
        updatedAt: now
      },
      {
        title: 'Internationalized Thesis Topic Browser',
        description: 'Build a topic browsing workflow for the English Informatics specialization.',
        professorId: elena.id,
        specializationId: infoEn.specialization.id,
        origin: 'professor',
        status: 'available',
        createdAt: now,
        updatedAt: now
      }
    ])
    .returning();

  const reservedTopic = insertedTopics.find((topic) => topic.title === 'AI-Based Scheduling Assistant');
  if (reservedTopic) {
    await db.insert(topicAssignments).values({
      studentId: secondStudent.id,
      professorId: reservedTopic.professorId,
      topicId: reservedTopic.id,
      title: reservedTopic.title,
      description: reservedTopic.description,
      status: 'active',
      createdAt: now,
      updatedAt: now
    });
  }

  await db.insert(topicRequests).values({
    studentId: student.id,
    professorId: professor.id,
    topicId: insertedTopics[0]?.id,
    type: 'topic_claim',
    status: 'pending',
    expiresAt: expiredAt,
    createdAt: new Date(now.getTime() - 80 * 60 * 60 * 1000),
    updatedAt: new Date(now.getTime() - 80 * 60 * 60 * 1000)
  });

  await db.insert(topicRequests).values({
    studentId: marketingStudent.id,
    professorId: professor.id,
    type: 'custom_proposal',
    customTitle: 'Blockchain for Secure Academic Records',
    customDescription: 'A rejected sample custom proposal for history and UI testing.',
    status: 'rejected',
    expiresAt: in72Hours,
    createdAt: now,
    updatedAt: now
  });

  console.log('Seeded verified Better Auth demo accounts');
}

seed();
