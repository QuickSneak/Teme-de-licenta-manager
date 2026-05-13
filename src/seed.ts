import { db } from './db';
import { faculties, specializations, users, accounts } from './db/schema';

async function seed() {
  const [fac] = await db.insert(faculties).values({ name: 'Informatica_si_Ingineri' }).returning();
  const [spec] = await db.insert(specializations).values({ name: 'Info', facultyId: fac.id }).returning();
  
const [student] = await db.insert(users).values({
  id: '1',
  email: 'test@gmail.com',
  name: 'Test Student',
  role: 'student',
  facultyId: fac.id,
  specializationId: spec.id,
  createdAt: new Date(),
  updatedAt: new Date()
}).returning();

await db.insert(accounts).values({
  id: '1',
  accountId: '1',
  providerId: 'local',
  userId: student.id,
  password: '123',
  createdAt: new Date(),
  updatedAt: new Date()
});

const [professor] = await db.insert(users).values({
  id: '2',
  email: 'prof@gmail.com',
  name: 'Test Professor',
  role: 'professor',
  facultyId: fac.id,
  specializationId: spec.id,
  createdAt: new Date(),
  updatedAt: new Date()
}).returning();

await db.insert(accounts).values({
  id: '2',
  accountId: '2',
  providerId: 'local',
  userId: professor.id,
  password: '123',
  createdAt: new Date(),
  updatedAt: new Date()
});
  
  console.log('Seeded');
}
seed();