import { createServerOnlyFn } from '@tanstack/react-start';
import { useSession } from '@tanstack/react-start/server';
import type * as t from '@/types';

const DEV_SECRET = 'dev-only-session-secret-minimum-32-chars!';

const MIN_SESSION_SECRET_LENGTH = 32;
const REVALIDATION_INTERVAL_MS = 60_000;
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

function resolveSessionSecret(): string {
  const sessionSecret =
    process.env.SESSION_SECRET || (process.env.NODE_ENV === 'development' ? DEV_SECRET : undefined);

  if (!sessionSecret) {
    throw new Error('SESSION_SECRET environment variable must be set for admin session encryption.');
  }

  if (sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new Error(
      `SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters for admin session encryption.`,
    );
  }

  if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'development') {
    console.warn(
      '[session] Using hardcoded DEV_SECRET — set SESSION_SECRET for production-like environments',
    );
  }

  return sessionSecret;
}

/**
 * `createServerOnlyFn`: this module is reachable from client-bundled routes
 * transitively (e.g. via server/utils/refresh.ts -> server/session.ts, even
 * though every real caller is server-only), so the bundler can't otherwise
 * prove these are safe to keep out of the client build. Every env-dependent
 * computation (including anything that can throw) has to live inside these
 * wrapped closures rather than at module scope — module-level code still
 * runs whenever the module is merely imported into the client bundle, even
 * though the wrapped function bodies themselves get stubbed out.
 */
export const getSessionConfig = createServerOnlyFn(() => {
  const envIdleTimeout = Number(process.env.ADMIN_SESSION_IDLE_TIMEOUT_MS);
  const idleTimeout =
    Number.isFinite(envIdleTimeout) && envIdleTimeout > 0 ? envIdleTimeout : DEFAULT_IDLE_TIMEOUT_MS;

  return {
    revalidationInterval: REVALIDATION_INTERVAL_MS,
    idleTimeout,
  } as const;
});

export const useAppSession = createServerOnlyFn(
  (): ReturnType<typeof useSession<t.SessionData>> => {
    const sessionCookieSecure =
      process.env.SESSION_COOKIE_SECURE !== undefined
        ? process.env.SESSION_COOKIE_SECURE === 'true'
        : process.env.NODE_ENV === 'production';
    const sessionCookiePath = process.env.VITE_BASE_PATH || '/';

    return useSession<t.SessionData>({
      name: 'admin-session',
      password: resolveSessionSecret(),
      cookie: {
        path: sessionCookiePath,
        secure: sessionCookieSecure,
        sameSite: 'lax',
        httpOnly: true,
        maxAge: 60 * 60 * 24 * 7,
      },
    });
  },
);
