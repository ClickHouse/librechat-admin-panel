import { z } from 'zod';
import { getRequestHeader } from '@tanstack/react-start/server';
import type * as t from '@/types';
import { useAppSession } from '../session';
import { getServerApiUrl } from './url';

const refreshResponseSchema = z.object({
  token: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
});

export interface RefreshedTokenset {
  token: string;
  refreshToken?: string;
  expiresAt?: number;
}

/**
 * Forwards the deployment's tenant header to the LibreChat backend so that
 * `preAuthTenantMiddleware` can scope the refresh lookup. Returns `undefined`
 * (no header) when the BFF request didn't carry one — single-tenant deploys.
 */
function readTenantHeader(): string | undefined {
  const raw = getRequestHeader('x-tenant-id');
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function extractRefreshTokenCookie(response: Response): string | undefined {
  const setCookies = response.headers.getSetCookie();
  for (const cookie of setCookies) {
    const match = cookie.match(/^refreshToken=([^;]+)/);
    if (match) return match[1];
  }
  return undefined;
}

/**
 * Calls the LibreChat refresh endpoint matching the session's token provider.
 *
 * - `openid` sessions hit `/api/admin/oauth/refresh` (body-based) and forward
 *   the deployment's `X-Tenant-Id` header so the backend's
 *   `preAuthTenantMiddleware` scopes the user lookup correctly.
 * - `librechat` sessions hit the cookie-based `/api/auth/refresh`.
 *
 * Returns `undefined` on any network or schema failure — callers decide
 * whether to clear the session.
 */
export async function refreshAdminToken(
  refreshToken: string,
  tokenProvider: t.SessionData['tokenProvider'],
  userId: string | undefined,
): Promise<RefreshedTokenset | undefined> {
  try {
    if (tokenProvider === 'openid') {
      if (!userId) {
        console.warn('[refreshAdminToken] openid refresh requires user id; aborting');
        return undefined;
      }
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const tenantId = readTenantHeader();
      if (tenantId) {
        headers['X-Tenant-Id'] = tenantId;
      }
      const response = await fetch(`${getServerApiUrl()}/api/admin/oauth/refresh`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ refresh_token: refreshToken, user_id: userId }),
      });
      if (!response.ok) return undefined;
      const parsed = refreshResponseSchema.safeParse(await response.json());
      if (!parsed.success) return undefined;
      return {
        token: parsed.data.token,
        refreshToken: parsed.data.refreshToken,
        expiresAt: parsed.data.expiresAt,
      };
    }

    const response = await fetch(`${getServerApiUrl()}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: `refreshToken=${refreshToken}` },
    });
    if (!response.ok) return undefined;
    const parsed = refreshResponseSchema.safeParse(await response.json());
    if (!parsed.success) return undefined;
    return {
      token: parsed.data.token,
      refreshToken: extractRefreshTokenCookie(response),
    };
  } catch (error) {
    console.warn('[refreshAdminToken] Token refresh request failed:', error);
    return undefined;
  }
}

const inFlight = new Map<string, Promise<RefreshedTokenset | undefined>>();

/**
 * Build the dedupe key from every discriminator that the upstream refresh
 * actually depends on: token provider, user identity, tenant header, and the
 * refresh token itself. Keying on `refreshToken` alone would conflate two
 * concurrent calls that happen to share a token string but differ by user or
 * tenant — the second caller would receive the first caller's bearer and
 * persist it into the wrong session.
 */
function buildDedupeKey(
  refreshToken: string,
  tokenProvider: t.SessionData['tokenProvider'],
  userId: string | undefined,
  tenantId: string | undefined,
): string {
  return [tokenProvider ?? '', userId ?? '', tenantId ?? '', refreshToken].join('\u0000');
}

/**
 * Module-scoped dedupe so two concurrent React Query subscribers in a single
 * BFF process don't both consume a rotating refresh token (which would
 * invalidate one of them).
 */
export function refreshAdminTokenDeduped(
  refreshToken: string,
  tokenProvider: t.SessionData['tokenProvider'],
  userId: string | undefined,
): Promise<RefreshedTokenset | undefined> {
  const key = buildDedupeKey(refreshToken, tokenProvider, userId, readTenantHeader());
  const existing = inFlight.get(key);
  if (existing) return existing;
  const pending = refreshAdminToken(refreshToken, tokenProvider, userId).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, pending);
  return pending;
}

/**
 * Refresh the bearer if the session is missing one or its `expiresAt` falls
 * within `skewMs` of now. Persists the rotated refresh token (if any) to the
 * session and returns the bearer the caller should use. Returns `undefined`
 * when no token is available and refresh either failed or is impossible.
 */
export async function ensureFreshBearer(skewMs: number): Promise<string | undefined> {
  const session = await useAppSession();
  const { token, expiresAt, refreshToken, tokenProvider, user } = session.data;

  if (!refreshToken) {
    return token;
  }

  const now = Date.now();
  const needsRefresh = !token || (typeof expiresAt === 'number' && expiresAt - now <= skewMs);
  if (!needsRefresh) {
    return token;
  }

  const refreshed = await refreshAdminTokenDeduped(refreshToken, tokenProvider, user?.id);
  if (!refreshed) {
    return token;
  }

  await session.update({
    token: refreshed.token,
    refreshToken: refreshed.refreshToken ?? refreshToken,
    expiresAt: refreshed.expiresAt,
    lastVerified: now,
    lastActivity: now,
  });
  return refreshed.token;
}

/**
 * After a 401 from a downstream admin call, force a refresh attempt regardless
 * of `expiresAt`. Returns the new bearer or `undefined` if refresh failed.
 */
export async function refreshOn401(): Promise<string | undefined> {
  const session = await useAppSession();
  const { refreshToken, tokenProvider, user } = session.data;
  if (!refreshToken) return undefined;

  const refreshed = await refreshAdminTokenDeduped(refreshToken, tokenProvider, user?.id);
  if (!refreshed) return undefined;

  const now = Date.now();
  await session.update({
    token: refreshed.token,
    refreshToken: refreshed.refreshToken ?? refreshToken,
    expiresAt: refreshed.expiresAt,
    lastVerified: now,
    lastActivity: now,
  });
  return refreshed.token;
}
