const devAuthSecret = 'dev-secret-change-before-production';
const placeholderAuthSecrets = new Set([
  devAuthSecret,
  'replace-with-a-long-random-secret',
  'generate-a-long-random-secret-at-least-32-chars'
]);

export function getAuthSecret() {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  const isProduction = process.env.NODE_ENV === 'production';

  if (!secret) {
    if (isProduction) {
      throw new Error('BETTER_AUTH_SECRET is required in production.');
    }

    return devAuthSecret;
  }

  if (isProduction && (secret.length < 32 || placeholderAuthSecrets.has(secret))) {
    throw new Error('BETTER_AUTH_SECRET must be a real random secret with at least 32 characters in production.');
  }

  return secret;
}
