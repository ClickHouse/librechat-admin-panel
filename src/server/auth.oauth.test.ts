import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

import { getStartupConfigFn, oauthExchangeFn, oauthLoginFn } from './auth';

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

    const result = await oauthExchangeFn({
      data: { code: 'a'.repeat(64), provider: 'openid' },
    });

    expect(result).toEqual({
      error: false,
      user: { id: 'user-1', role: 'ADMIN', email: 'admin@example.com' },
      redirectTo: '/',
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

  it('returns the post-login redirect captured at login start and clears it from the session', async () => {
    sessionState.data = { codeVerifier: 'verifier-123', postLoginRedirect: '/users' };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        token: 'jwt-token',
        expiresAt: 123456,
        user: { id: 'user-1', role: 'ADMIN', email: 'admin@example.com' },
      }),
    );

    const result = await oauthExchangeFn({
      data: { code: 'a'.repeat(64), provider: 'openid' },
    });

    expect(result).toMatchObject({ error: false, redirectTo: '/users' });
    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({ postLoginRedirect: undefined }),
    );
  });

  it('sanitizes an unsafe stored redirect back to the dashboard', async () => {
    sessionState.data = { codeVerifier: 'verifier-123', postLoginRedirect: '//evil.com' };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        token: 'jwt-token',
        expiresAt: 123456,
        user: { id: 'user-1', role: 'ADMIN', email: 'admin@example.com' },
      }),
    );

    const result = await oauthExchangeFn({
      data: { code: 'a'.repeat(64), provider: 'openid' },
    });

    expect(result).toMatchObject({ error: false, redirectTo: '/' });
  });

  it('stores the sanitized post-login redirect in the session when starting login', async () => {
    await oauthLoginFn({ data: { provider: 'google', redirectTo: '/access' } });
    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({ postLoginRedirect: '/access' }),
    );

    updateSession.mockClear();
    await oauthLoginFn({ data: { provider: 'google', redirectTo: 'https://evil.com' } });
    expect(updateSession).toHaveBeenCalledWith(expect.objectContaining({ postLoginRedirect: '/' }));
  });

  it('does not consume the one-time LibreChat exchange code when the PKCE verifier was lost', async () => {
    sessionState.data = {};

    const result = await oauthExchangeFn({
      data: { code: 'b'.repeat(64), provider: 'openid' },
    });

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

describe('getStartupConfigFn', () => {
  const originalSsoEnabled = process.env.ADMIN_SSO_ENABLED;
  const originalSsoOnly = process.env.ADMIN_SSO_ONLY;

  beforeEach(() => {
    fetchMock.mockReset();
    warnSpy.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    delete process.env.ADMIN_SSO_ENABLED;
    delete process.env.ADMIN_SSO_ONLY;
  });

  afterEach(() => {
    if (originalSsoEnabled === undefined) delete process.env.ADMIN_SSO_ENABLED;
    else process.env.ADMIN_SSO_ENABLED = originalSsoEnabled;
    if (originalSsoOnly === undefined) delete process.env.ADMIN_SSO_ONLY;
    else process.env.ADMIN_SSO_ONLY = originalSsoOnly;
  });

  it('lists each LibreChat-enabled provider with branding overrides', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        openidLoginEnabled: true,
        googleLoginEnabled: true,
        socialLoginEnabled: true,
        openidLabel: 'Corp SSO',
        openidImageUrl: 'https://corp.example/logo.png',
      }),
    );

    const result = await getStartupConfigFn();

    expect(result).toEqual({
      providers: [
        { id: 'openid', label: 'Corp SSO', imageUrl: 'https://corp.example/logo.png' },
        { id: 'google', label: undefined, imageUrl: undefined },
      ],
      ssoOnly: false,
    });
    expect(fetchMock).toHaveBeenCalledWith('http://librechat.test/api/config', { headers: {} });
  });

  it('marks the session SSO-only when ADMIN_SSO_ONLY=true', async () => {
    process.env.ADMIN_SSO_ONLY = 'true';
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { openidLoginEnabled: true }));

    const result = await getStartupConfigFn();

    expect(result).toEqual({
      providers: [{ id: 'openid', label: undefined, imageUrl: undefined }],
      ssoOnly: true,
    });
  });

  it('hides social providers when LibreChat has not enabled social login', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        openidLoginEnabled: true,
        googleLoginEnabled: true,
        socialLoginEnabled: false,
      }),
    );

    const result = await getStartupConfigFn();

    expect(result).toEqual({
      providers: [{ id: 'openid', label: undefined, imageUrl: undefined }],
      ssoOnly: false,
    });
  });

  it('hides a provider omitted from the socialLogins allowlist even when enabled', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        openidLoginEnabled: true,
        googleLoginEnabled: true,
        socialLoginEnabled: true,
        socialLogins: ['openid'],
      }),
    );

    const result = await getStartupConfigFn();

    expect(result).toEqual({
      providers: [{ id: 'openid', label: undefined, imageUrl: undefined }],
      ssoOnly: false,
    });
  });

  it('forwards X-Tenant-Id to the LibreChat startup config request', async () => {
    requestHeaders.set('x-tenant-id', 'tenant-42');
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { openidLoginEnabled: true }));

    await getStartupConfigFn();

    expect(fetchMock).toHaveBeenCalledWith('http://librechat.test/api/config', {
      headers: { 'X-Tenant-Id': 'tenant-42' },
    });
  });

  it('hides every SSO provider without calling the backend when ADMIN_SSO_ENABLED=false', async () => {
    process.env.ADMIN_SSO_ENABLED = 'false';

    const result = await getStartupConfigFn();

    expect(result).toEqual({ providers: [], ssoOnly: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets ADMIN_SSO_ENABLED=false take precedence over ADMIN_SSO_ONLY=true', async () => {
    process.env.ADMIN_SSO_ENABLED = 'false';
    process.env.ADMIN_SSO_ONLY = 'true';

    const result = await getStartupConfigFn();

    expect(result).toEqual({ providers: [], ssoOnly: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns an empty provider list when the startup config request fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, {}));

    const result = await getStartupConfigFn();

    expect(result).toEqual({ providers: [], ssoOnly: false });
  });
});
