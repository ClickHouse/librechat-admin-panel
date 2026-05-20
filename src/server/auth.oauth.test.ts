import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MISSING_PKCE_VERIFIER_MESSAGE } from './utils/oauth';

const fetchMock = vi.fn();
const updateSession = vi.fn();
const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
const requestHeaders = new Map<string, string>();
const sessionState: { data: Record<string, unknown> } = { data: {} };

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    handler: (fn: (...args: unknown[]) => unknown) => fn,
    inputValidator: () => ({
      handler: (fn: (...args: unknown[]) => unknown) => fn,
    }),
  }),
}));

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeader: (name: string) => requestHeaders.get(name.toLowerCase()),
}));

vi.mock('@tanstack/react-query', () => ({
  queryOptions: (opts: unknown) => opts,
}));

vi.mock('./session', () => ({
  SESSION_CONFIG: {
    revalidationInterval: 60_000,
    idleTimeout: 30 * 60 * 1000,
  },
  useAppSession: vi.fn(async () => ({
    data: sessionState.data,
    update: updateSession,
  })),
}));

vi.mock('./utils/url', () => ({
  getApiBaseUrl: () => 'http://admin.test',
  getServerApiUrl: () => 'http://librechat.test',
}));

vi.mock('./utils/refresh', () => ({
  refreshAdminTokenDeduped: vi.fn(),
}));

import { oauthExchangeFn } from './auth';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('oauthExchangeFn', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    updateSession.mockReset();
    warnSpy.mockClear();
    sessionState.data = {};
    requestHeaders.clear();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('exchanges the callback code with the PKCE verifier stored in the admin session', async () => {
    sessionState.data = { codeVerifier: 'verifier-123' };
    requestHeaders.set('origin', 'http://admin.test');
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        token: 'jwt-token',
        refreshToken: 'refresh-token',
        expiresAt: 123456,
        user: { id: 'user-1', role: 'ADMIN', email: 'admin@example.com' },
      }),
    );

    const result = await oauthExchangeFn({ data: { code: 'a'.repeat(64) } });

    expect(result).toEqual({
      error: false,
      user: { id: 'user-1', role: 'ADMIN', email: 'admin@example.com' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('http://librechat.test/api/admin/oauth/exchange', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://admin.test',
      },
      body: JSON.stringify({ code: 'a'.repeat(64), code_verifier: 'verifier-123' }),
    });
    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'jwt-token',
        refreshToken: 'refresh-token',
        tokenProvider: 'openid',
        codeVerifier: undefined,
      }),
    );
  });

  it('does not consume the one-time LibreChat exchange code when the PKCE verifier was lost', async () => {
    sessionState.data = {};

    const result = await oauthExchangeFn({ data: { code: 'b'.repeat(64) } });

    expect(result).toEqual({
      error: true,
      message: MISSING_PKCE_VERIFIER_MESSAGE,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateSession).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[oauthExchangeFn] Missing PKCE verifier from admin session; check SESSION_COOKIE_SECURE for HTTP deployments',
    );
  });
});
