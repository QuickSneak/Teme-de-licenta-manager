import { Elysia, t } from 'elysia';
import { staticPlugin } from '@elysiajs/static';
import { db } from './db';
import { users, accounts } from './db/schema'; // Added accounts
import { eq } from 'drizzle-orm';

new Elysia()
  .use(staticPlugin({ assets: 'src', prefix: '' }))
  .get('/', () => Bun.file('src/login.html'))
  .post('/login', async ({ body, set }) => {
    // 1. Find User
    const user = await db.select().from(users).where(eq(users.email, body.email)).get();
    
    if (!user || user.role !== body.role) {
      set.status = 401;
      return { error: 'Invalid user' };
    }

    // 2. Find Account & Check Password
    const account = await db.select().from(accounts).where(eq(accounts.userId, user.id)).get();
    
    // Note: Plaintext check for prototype only. Real apps use hashed passwords.
    if (!account || account.password !== body.password) {
      set.status = 401;
      return { error: 'Invalid password' };
    }

  return {
    redirect:
      user.role === 'student'
        ? '/dashboard.html'
        : user.role === 'professor'
        ? '/professor-dashboard.html'
        : '/secretary-dashboard.html'
  };
  }, { 
    body: t.Object({ email: t.String(), password: t.String(), role: t.String() }) 
  })
  .listen(3000);
