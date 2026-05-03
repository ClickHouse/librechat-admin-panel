import { z } from 'zod';
import crypto from 'crypto';
import { redirect } from '@tanstack/react-router';
import { queryOptions } from '@tanstack/react-query';
import { SystemRoles } from 'librechat-data-provider';
import { createServerFn } from '@tanstack/react-start';
import { getRequestHeader } from '@tanstack/react-start/server';
import type * as t from '@/types';
import { OAUTH_PROVIDERS } from '@/constants';
import { useAppSession, SESSION_CONFIG } from './session';
import { getApiBaseUrl, getServerApiUrl } from './utils/api';

/** Extract a named cookie value from `set-cookie` response headers. */
function extractCookieValue(response: Response, name: string): string | undefined {
  const setCookies = response.headers.getSetCookie();
  const re = new RegExp(`^${name}=([^;]+)`);
  for (const cookie of setCookies) {
    const match = cookie.match(re);
    if (match) return match[1];
  }
  return undefined;
}

export const adminLoginFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      email: z.string().email('Valid email address is required'),
      password: z.string().min(1, 'Password is required'),
    }),
  )
  .handler(async ({ data }) => {
    try {
      const response = await fetch(`${getServerApiUrl()}/api/admin/login/local`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const responseData = await response.json();

      if (!response.ok) {
        switch (response.status) {
          case 403:
            return { error: true, message: 'You do not have admin privileges' };
          case 404:
            return { error: true, message: 'User not found' };
          case 422:
            return { error: true, message: responseData.message || 'Invalid credentials' };
          case 429:
            return { error: true, message: 'Too many login attempts. Please try again later' };
          default:
            return { error: true, message: responseData.message || 'Login failed' };
        }
      }

      const loginData = responseData as t.AdminLoginResponse;

      if (loginData.twoFAPending) {
        return {
          error: false,
          requires2FA: true,
          tempToken: loginData.tempToken,
        };
      }

      if (loginData.user.role !== SystemRoles.ADMIN) {
        return { error: true, message: 'You do not have admin privileges' };
      }

      const now = Date.now();
      const session = await useAppSession();
      await session.update({
        user: loginData.user,
        token: loginData.token,
        refreshToken: extractCookieValue(response, 'refreshToken'),
        tokenProvider: 'librechat',
        lastVerified: now,
        lastActivity: now,
      });

      return { error: false, user: loginData.user };
    } catch (error) {
      console.error('Admin login error:', error);
      return { error: true, message: 'Login failed. Please check your connection and try again.' };
    }
  });

export const adminVerify2FAFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      tempToken: z.string().min(1, 'Temporary token is required'),
      totpCode: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
    }),
  )
  .handler(async ({ data }) => {
    try {
      const response = await fetch(`${getServerApiUrl()}/api/auth/2fa/verify-temp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempToken: data.tempToken, token: data.totpCode }),
      });

      const responseData = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          const msg = typeof responseData.message === 'string' ? responseData.message : '';
          const isExpired = msg.toLowerCase().includes('expired');
          return {
            error: true,
            expired: isExpired,
            message: isExpired
              ? 'Session expired. Please log in again.'
              : 'Invalid verification code',
          };
        }
        return { error: true, message: responseData.message || '2FA verification failed' };
      }

      const verifyData = responseData as t.TwoFAVerifyResponse;

      if (verifyData.user.role !== SystemRoles.ADMIN) {
        return { error: true, message: 'You do not have admin privileges' };
      }

      const now = Date.now();
      const session = await useAppSession();
      await session.update({
        user: verifyData.user,
        token: verifyData.token,
        refreshToken: extractCookieValue(response, 'refreshToken'),
        tokenProvider: 'librechat',
        lastVerified: now,
        lastActivity: now,
      });

      return { error: false, user: verifyData.user };
    } catch (error) {
      console.error('2FA verification error:', error);
      return { error: true, message: 'Verification failed. Please try again.' };
    }
  });

const clearSession = async (session: Awaited<ReturnType<typeof useAppSession>>) => {
  await session.update({
    token: undefined,
    user: undefined,
    refreshToken: undefined,
    tokenProvider: undefined,
    lastVerified: undefined,
    lastActivity: undefined,
  });
};

/**
 * Attempt to refresh the JWT using the stored refresh token.
 * Returns the new token and refreshToken on success, or undefined on failure.
 *
 * Note: concurrent callers sharing a rotating refresh token may race; the
 * current call pattern (single React Query with 60s interval) is sequential.
 */
const refreshResponseSchema = z.object({ token: z.string() });

async function refreshAdminToken(
  refreshToken: string,
  tokenProvider: t.SessionData['tokenProvider'],
): Promise<{ token: string; refreshToken?: string } | undefined> {
  try {
    const cookieParts = [`refreshToken=${refreshToken}`];
    if (tokenProvider === 'openid') {
      cookieParts.push('token_provider=openid');
    }

    const response = await fetch(`${getServerApiUrl()}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: cookieParts.join('; ') },
    });

    if (!response.ok) return undefined;

    const parsed = refreshResponseSchema.safeParse(await response.json());
    if (!parsed.success) return undefined;

    return {
      token: parsed.data.token,
      refreshToken: extractCookieValue(response, 'refreshToken'),
    };
  } catch (error) {
    console.warn('[refreshAdminToken] Token refresh request failed:', error);
    return undefined;
  }
}

export const verifyAdminTokenFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const session = await useAppSession();
    const { token, user, lastVerified, lastActivity, refreshToken, tokenProvider } = session.data;

    if (!token || !user) {
      return { valid: false, error: 'No session found' };
    }

    if (user.role !== SystemRoles.ADMIN) {
      await clearSession(session);
      return { valid: false, error: 'Not an admin user' };
    }

    const now = Date.now();

    if (lastActivity && now - lastActivity > SESSION_CONFIG.idleTimeout) {
      await clearSession(session);
      return { valid: false, error: 'Session expired due to inactivity' };
    }

    const needsRevalidation =
      !lastVerified || now - lastVerified > SESSION_CONFIG.revalidationInterval;

    if (needsRevalidation) {
      try {
        const response = await fetch(`${getServerApiUrl()}/api/admin/verify`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
          if (response.status === 403) {
            await clearSession(session);
            return { valid: false, error: 'Admin privileges have been revoked' };
          }
          if (response.status === 401) {
            if (refreshToken) {
              const refreshed = await refreshAdminToken(refreshToken, tokenProvider);
              if (refreshed) {
                const refreshedSession = {
                  token: refreshed.token,
                  refreshToken: refreshed.refreshToken ?? refreshToken,
                  lastVerified: now,
                  lastActivity: now,
                };
                try {
                  const reVerify = await fetch(`${getServerApiUrl()}/api/admin/verify`, {
                    headers: { Authorization: `Bearer ${refreshed.token}` },
                  });
                  if (reVerify.ok) {
                    await session.update(refreshedSession);
                    return { valid: true, user };
                  }
                } catch {
                  await session.update(refreshedSession);
                  return { valid: true, user };
                }
              }
            }
            console.warn(
              '[verifyAdminTokenFn] Token refresh failed or unavailable, clearing session',
            );
            await clearSession(session);
            return { valid: false, error: 'Session is no longer valid' };
          }
          console.warn(
            '[verifyAdminTokenFn] Re-validation returned non-auth error, allowing cached session:',
            response.status,
          );
        }

        await session.update({ lastVerified: now, lastActivity: now });
      } catch (error) {
        console.warn(
          '[verifyAdminTokenFn] Re-validation call failed, allowing cached session:',
          error,
        );
        await session.update({ lastVerified: now, lastActivity: now });
      }
    } else {
      await session.update({ lastActivity: now });
    }

    return { valid: true, user };
  } catch (error) {
    console.error('Token verification error:', error);
    return { valid: false, error: 'Verification failed' };
  }
});

export const requireAuthFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ location: z.string() }))
  .handler(async ({ data }) => {
    const verifyResult = await verifyAdminTokenFn();

    if (!verifyResult.valid) {
      throw redirect({
        to: '/login',
        search: { redirect: data.location },
      });
    }

    return {
      isAuthenticated: true,
      user: verifyResult.user ?? null,
    };
  });

export const adminLogoutFn = createServerFn({ method: 'POST' }).handler(async () => {
  try {
    const session = await useAppSession();
    const token = session.data.token;

    if (token) {
      try {
        await fetch(`${getServerApiUrl()}/api/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // Ignore remote logout errors
      }
    }

    await clearSession(session);

    return { error: false };
  } catch (error) {
    console.error('Admin logout error:', error);
    return { error: true, message: 'Logout failed' };
  }
});

export const getCurrentUserFn = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await useAppSession();
  return {
    user: session.data.user ?? null,
    isAuthenticated: !!session.data.token,
  };
});

const oauthProviderSchema = z.enum(['openid', 'google']);

/**
 * Resolve which OAuth providers LibreChat has configured by reading the public
 * /api/config startup payload — the same endpoint LibreChat's own client uses to
 * decide which social-login buttons to render. Provider availability is derived
 * from the boolean *LoginEnabled flags; deployer-supplied label/imageUrl
 * overrides are forwarded for the providers that support them (openid, saml).
 *
 * ssoOnly is independent of LibreChat: it remains an admin-panel-side knob
 * (`ADMIN_SSO_ONLY`) so admins can keep a password fallback even when chat
 * users are auto-redirected.
 */
export const getStartupConfigFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<t.AdminStartupConfig> => {
    const ssoOnly = process.env.ADMIN_SSO_ONLY === 'true';
    try {
      const response = await fetch(`${getServerApiUrl()}/api/config`);
      if (!response.ok) return { providers: [], ssoOnly };
      const config = (await response.json()) as t.StartupConfigResponse;
      const providers: t.ResolvedProvider[] = [];
      for (const def of OAUTH_PROVIDERS) {
        if (config[def.enabledKey as keyof t.StartupConfigResponse] !== true) continue;
        providers.push({
          id: def.id,
          label: def.labelKey
            ? (config[def.labelKey as keyof t.StartupConfigResponse] as string | undefined)
            : undefined,
          imageUrl: def.imageKey
            ? (config[def.imageKey as keyof t.StartupConfigResponse] as string | undefined)
            : undefined,
        });
      }
      return { providers, ssoOnly };
    } catch {
      return { providers: [], ssoOnly };
    }
  },
);

/** Shared queryOptions so consumers deduplicate the startup-config fetch. */
export const startupConfigOptions = queryOptions({
  queryKey: ['adminStartupConfig'],
  queryFn: () => getStartupConfigFn(),
  staleTime: 60_000,
});

async function buildOAuthLoginUrl(provider: t.OAuthProvider): Promise<string> {
  const def = OAUTH_PROVIDERS.find((p) => p.id === provider);
  if (!def) throw new Error(`Unknown OAuth provider: ${provider}`);

  const authUrl = new URL(`${getApiBaseUrl()}${def.startPath}`);

  /** Generate PKCE code_verifier and store in admin session for the exchange step. */
  const codeVerifier = crypto.randomBytes(32).toString('hex');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('hex');
  authUrl.searchParams.set('code_challenge', codeChallenge);

  const session = await useAppSession();
  await session.update({ codeVerifier });

  return authUrl.toString();
}

export const oauthLoginFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ provider: oauthProviderSchema }))
  .handler(async ({ data }) => {
    try {
      const authUrl = await buildOAuthLoginUrl(data.provider);
      return { error: false as const, authUrl };
    } catch (error) {
      console.error(`[oauthLoginFn] ${data.provider} initiation error:`, error);
      return { error: true as const, message: 'Failed to initiate SSO login' };
    }
  });

export const oauthExchangeFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      code: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid exchange code format'),
      provider: oauthProviderSchema,
    }),
  )
  .handler(async ({ data }) => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const rawOrigin = getRequestHeader('origin') || getRequestHeader('referer');
      if (rawOrigin) {
        try {
          headers['Origin'] = new URL(rawOrigin).origin;
        } catch {
          // malformed URL – skip forwarding
        }
      }

      /** Read PKCE code_verifier from session (stored during oauthLoginFn). */
      const session = await useAppSession();
      const { codeVerifier } = session.data;

      const response = await fetch(`${getServerApiUrl()}/api/admin/oauth/exchange`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ code: data.code, code_verifier: codeVerifier }),
      });

      const responseData = await response.json();

      if (!response.ok) {
        const errorCode = responseData.error_code;
        switch (errorCode) {
          case 'MISSING_CODE':
            return { error: true, message: 'Authorization code is required' };
          case 'INVALID_CODE_FORMAT':
            return { error: true, message: 'Invalid authorization code format' };
          case 'INVALID_OR_EXPIRED_CODE':
            return { error: true, message: 'Authorization code has expired. Please try again.' };
          default:
            if (response.status === 429)
              return { error: true, message: 'Too many requests. Please wait and try again.' };
            if (response.status === 403)
              return { error: true, message: 'You do not have admin privileges' };
            return { error: true, message: responseData.message || 'OAuth exchange failed' };
        }
      }

      const exchangeData = responseData as t.OAuthExchangeResponse;
      const now = Date.now();
      await session.update({
        user: exchangeData.user,
        token: exchangeData.token,
        refreshToken: exchangeData.refreshToken ?? extractCookieValue(response, 'refreshToken'),
        tokenProvider: data.provider,
        lastVerified: now,
        lastActivity: now,
        codeVerifier: undefined,
      });

      return { error: false, user: exchangeData.user };
    } catch (error) {
      console.error('OAuth exchange error:', error);
      return { error: true, message: 'Failed to complete authentication. Please try again.' };
    }
  });
