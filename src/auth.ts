import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { db } from './db';
import { accounts, sessions, users, verifications } from './db/schema';
import { sendPasswordResetEmail, sendVerificationEmail } from './email';

const hour = 60 * 60;
const day = hour * 24;

function appURL(path: string) {
  const configuredURL = process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? 'http://localhost:3000';
  const origin = new URL(configuredURL).origin;
  return new URL(path, origin).toString();
}

export const auth = betterAuth({
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
    requireEmailVerification: true,
    resetPasswordTokenExpiresIn: hour,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, token }) => {
      const url = appURL(`/reset-password.html?token=${encodeURIComponent(token)}`);
      await sendPasswordResetEmail(user.email, url);
    }
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    expiresIn: hour,
    autoSignInAfterVerification: false,
    sendVerificationEmail: async ({ user, url }) => {
      await sendVerificationEmail(user.email, url);
    }
  },
  session: {
    expiresIn: 30 * day,
    updateAge: day
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
