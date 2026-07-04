import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { eq } from 'drizzle-orm';
import { getAuthSecret } from './config';
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
  secret: getAuthSecret(),
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
      bio: {
        type: 'string',
        required: false,
        defaultValue: ''
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
  role: 'student' | 'professor' | 'secretary' | 'admin';
  facultyId?: number;
  specializationId?: number;
  academicTitle?: string;
  officeLocation?: string;
  workingHours?: string;
  bio?: string;
}) {
  await seedAuth.api.signUpEmail({
    body: {
      name: input.name,
      email: input.email,
      password: input.password,
      bio: input.bio ?? '',
      role: input.role,
      facultyId: input.facultyId,
      specializationId: input.specializationId,
      isExtended: false
    }
  });

  await db.update(users).set({ emailVerified: true }).where(eq(users.email, input.email));
  await db
    .update(users)
    .set({
      academicTitle: input.academicTitle ?? null,
      officeLocation: input.officeLocation ?? null,
      workingHours: input.workingHours ?? null
    })
    .where(eq(users.email, input.email));
  const user = await db.select().from(users).where(eq(users.email, input.email)).get();
  if (!user) throw new Error(`Could not create seed user ${input.email}`);
  return user;
}

async function seed() {
  await db.delete(notifications);
  await db.delete(topicChangeRequests);
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

  await createUser({
    name: 'Test Student',
    email: 'student.test.info23@uab.ro',
    password: 'password123',
    role: 'student',
    facultyId: info.faculty.id,
    specializationId: info.specialization.id
  });

  await createUser({
    name: 'Marketing Test Student',
    email: 'student.marketing.mk23@uab.ro',
    password: 'password123',
    role: 'student',
    facultyId: marketing.faculty.id,
    specializationId: marketing.specialization.id
  });

  const infoProfessor = await createUser({
    name: 'Informatica Professor',
    email: 'professor.info@uab.ro',
    password: 'password123',
    role: 'professor',
    academicTitle: 'Conf. univ. dr.',
    officeLocation: 'Building A, room 204',
    workingHours: 'Mon 10:00 - 12:00',
    bio: 'Coordinates thesis topics in Informatica and software systems.'
  });

  await db.insert(professorSpecializations).values({
    professorId: infoProfessor.id,
    specializationId: info.specialization.id
  });

  const multiProfessor = await createUser({
    name: 'Multi Specialization Professor',
    email: 'professor.multi@uab.ro',
    password: 'password123',
    role: 'professor',
    academicTitle: 'Prof. univ. dr.',
    officeLocation: 'Building A, room 208',
    workingHours: 'Wed 12:00 - 14:00',
    bio: 'Supervises interdisciplinary thesis topics across Informatica and Marketing.'
  });

  await db.insert(professorSpecializations).values([
    {
      professorId: multiProfessor.id,
      specializationId: info.specialization.id
    },
    {
      professorId: multiProfessor.id,
      specializationId: infoEn.specialization.id
    },
    {
      professorId: multiProfessor.id,
      specializationId: marketing.specialization.id
    }
  ]);

  await createUser({
    name: 'Informatica Secretary',
    email: 'secretary.info@uab.ro',
    password: 'password123',
    role: 'secretary',
    facultyId: info.faculty.id,
    officeLocation: 'Dean office, Building A',
    workingHours: 'Mon - Fri, 08:00 - 16:00',
    bio: 'Faculty secretary for Informatica si Inginerie. Teams account: secretary.info@uab.ro'
  });

  await createUser({
    name: 'Test Secretary',
    email: 'secretary.marketing@uab.ro',
    password: 'password123',
    role: 'secretary',
    facultyId: marketing.faculty.id,
    officeLocation: 'Dean office, Building B',
    workingHours: 'Mon - Fri, 08:00 - 16:00',
    bio: 'Faculty secretary for Stiinte Economice. Teams account: secretary.marketing@uab.ro'
  });

  await createUser({
    name: 'System Admin',
    email: 'admin@uab.ro',
    password: 'password123',
    role: 'admin'
  });

  console.log('Seeded verified Better Auth demo accounts');
}

seed();
