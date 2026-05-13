import { db } from './db';
import { faculties, specializations, users, accounts } from './db/schema';

async function seed2() {
  
const [secretariat] = await db.insert(users).values({
  id: '3',
  email: 'secretariat@gmail.com',
  name: 'Test Secretariat',
  role: 'secretary',
  facultyId: 1,
  specializationId: 1,
  createdAt: new Date(),
  updatedAt: new Date()
}).returning();

await db.insert(accounts).values({
  id: '3',
  accountId: '3',
  providerId: 'local',
  userId: secretariat.id,
  password: '123',
  createdAt: new Date(),
  updatedAt: new Date()
});
  
  console.log('Seeded');
}
seed2();
