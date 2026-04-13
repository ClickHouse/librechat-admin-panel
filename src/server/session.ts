import { useSession } from '@tanstack/react-start/server';
import type * as t from '@/types';

const DEV_SECRET = 'dev-only-session-secret-minimum-32-chars!';

const REVALIDATION_INTERVAL_MS = 60_000;
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

const envIdleTimeout = Number(process.env.ADMIN_SESSION_IDLE_TIMEOUT_MS);
const effectiveIdleTimeout =
  Number.isFinite(envIdleTimeout) && envIdleTimeout > 0 ? envIdleTimeout : DEFAULT_IDLE_TIMEOUT_MS;

const sessionCookieSecure =
  process.env.SESSION_COOKIE_SECURE !== undefined
    ? process.env.SESSION_COOKIE_SECURE === 'true'
    : process.env.NODE_ENV === 'production';

export const SESSION_CONFIG = {
  revalidationInterval: REVALIDATION_INTERVAL_MS,
  idleTimeout: effectiveIdleTimeout,
} as const;

const sessionSecret =
  process.env.SESSION_SECRET || (process.env.NODE_ENV === 'development' ? DEV_SECRET : undefined);

if (!sessionSecret) {
  throw new Error('SESSION_SECRET environment variable must be set for admin session encryption.');
}

if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'development') {
  console.warn(
    '[session] Using hardcoded DEV_SECRET — set SESSION_SECRET for production-like environments',
  );
}

export function useAppSession(): ReturnType<typeof useSession<t.SessionData>> {
  return useSession<t.SessionData>({
    name: 'admin-session',
    password: sessionSecret || '',
    cookie: {
      secure: sessionCookieSecure,
      sameSite: 'lax',
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 7,
    },
  });
}
