import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MISSING_PKCE_VERIFIER_MESSAGE } from './utils/oauth';

const fetchMock = vi.fn();
const updateSession = vi.fn();
const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
const requestHeaders = new Map<string, string>();
const sessionState: { data: Record<string, unknown> } = { data: {} };

vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T extends (...args: never[]) => unknown>(fn: T) => fn,
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
  getSessionConfig: () => ({
    revalidationInterval: 60_000,
    idleTimeout: 30 * 60 * 1000,
  }),
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
  withTenantHeader: (headers: Record<string, string> = {}) => {
    const tenantId = requestHeaders.get('x-tenant-id')?.trim();
    return tenantId ? { ...headers, 'X-Tenant-Id': tenantId } : headers;
  },
}));

import {
  adminLoginFn,
  adminVerify2FAFn,
  checkOpenIdFn,
  oauthExchangeFn,
  verifyAdminTokenFn,
} from './auth';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  requestHeaders.clear();
});

describe('adminLoginFn', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    updateSession.mockReset();
    sessionState.data = {};
    vi.stubGlobal('fetch', fetchMock);
  });

  it('accepts a backend-approved delegated admin without requiring the ADMIN role', async () => {
    const user = { id: 'user-1', role: 'department-admin', email: 'delegate@example.com' };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: 'jwt-token', user }));

    const result = await adminLoginFn({
      data: { email: 'delegate@example.com', password: 'password' },
    });

    expect(result).toEqual({ error: false, user });
    expect(fetchMock).toHaveBeenCalledWith('http://librechat.test/api/admin/login/local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'delegate@example.com', password: 'password' }),
    });
    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        user,
        token: 'jwt-token',
        tokenProvider: 'librechat',
      }),
    );
  });

  it('forwards the authoritative tenant when performing a local login', async () => {
    requestHeaders.set('x-tenant-id', 'tenant-b');
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        token: 'jwt-token',
        user: { id: 'user-1', tenantId: 'tenant-b' },
      }),
    );

    await adminLoginFn({ data: { email: 'admin@example.com', password: 'password' } });

    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      'X-Tenant-Id': 'tenant-b',
    });
  });
});

describe('adminVerify2FAFn', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    updateSession.mockReset();
    sessionState.data = {};
    vi.stubGlobal('fetch', fetchMock);
  });

  it('accepts a backend-approved delegated admin after 2FA verification', async () => {
    const user = { id: 'user-2', role: 'department-admin', email: 'delegate2@example.com' };
    const verifiedUser = { ...user, name: 'Delegated Admin' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { token: 'jwt-token-2', user }))
      .mockResolvedValueOnce(jsonResponse(200, { user: verifiedUser }));

    const result = await adminVerify2FAFn({
      data: { tempToken: 'temp-token', totpCode: '123456' },
    });

    expect(result).toEqual({ error: false, user: verifiedUser });
    expect(fetchMock).toHaveBeenCalledWith('http://librechat.test/api/auth/2fa/verify-temp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken: 'temp-token', token: '123456' }),
    });
    expect(fetchMock).toHaveBeenCalledWith('http://librechat.test/api/admin/verify', {
      headers: { Authorization: 'Bearer jwt-token-2' },
    });
    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        user: verifiedUser,
        token: 'jwt-token-2',
        tokenProvider: 'librechat',
      }),
    );
  });

  it('rejects a 2FA token that does not pass admin capability revalidation', async () => {
    const user = { id: 'user-2', role: 'regular-user', email: 'user@example.com' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { token: 'user-jwt-token', user }))
      .mockResolvedValueOnce(jsonResponse(403, {}));

    const result = await adminVerify2FAFn({
      data: { tempToken: 'temp-token', totpCode: '123456' },
    });

    expect(result).toEqual({ error: true, message: 'You do not have admin privileges' });
    expect(fetchMock).toHaveBeenCalledWith('http://librechat.test/api/admin/verify', {
      headers: { Authorization: 'Bearer user-jwt-token' },
    });
    expect(updateSession).not.toHaveBeenCalled();
  });

  it('forwards the authoritative tenant through 2FA and admin revalidation', async () => {
    requestHeaders.set('x-tenant-id', 'tenant-b');
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { token: 'jwt-token-2' }))
      .mockResolvedValueOnce(jsonResponse(200, { user: { id: 'user-2', tenantId: 'tenant-b' } }));

    await adminVerify2FAFn({ data: { tempToken: 'temp-token', totpCode: '123456' } });

    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      'X-Tenant-Id': 'tenant-b',
    });
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).toMatchObject({
      'X-Tenant-Id': 'tenant-b',
      Authorization: 'Bearer jwt-token-2',
    });
  });
});

describe('verifyAdminTokenFn', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    updateSession.mockReset();
    sessionState.data = {};
    vi.stubGlobal('fetch', fetchMock);
  });

  it('keeps a fresh delegated admin session without requiring the ADMIN role', async () => {
    const user = { id: 'user-3', role: 'department-admin', email: 'delegate3@example.com' };
    sessionState.data = {
      user,
      token: 'jwt-token-3',
      lastVerified: Date.now(),
      lastActivity: Date.now(),
    };

    const result = await verifyAdminTokenFn();

    expect(result).toEqual({ valid: true, user });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateSession).toHaveBeenCalledWith({ lastActivity: expect.any(Number) });
  });

  it('clears a delegated admin session when backend capability revalidation is denied', async () => {
    const user = { id: 'user-4', role: 'department-admin', email: 'delegate4@example.com' };
    sessionState.data = {
      user,
      token: 'jwt-token-4',
      lastVerified: 0,
      lastActivity: Date.now(),
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(403, {}));

    const result = await verifyAdminTokenFn();

    expect(result).toEqual({ valid: false, error: 'Admin privileges have been revoked' });
    expect(fetchMock).toHaveBeenCalledWith('http://librechat.test/api/admin/verify', {
      headers: { Authorization: 'Bearer jwt-token-4' },
    });
    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        token: undefined,
        user: undefined,
        refreshToken: undefined,
      }),
    );
  });

  it('forwards the authoritative tenant during periodic admin revalidation', async () => {
    requestHeaders.set('x-tenant-id', 'tenant-b');
    sessionState.data = {
      user: { id: 'user-4', tenantId: 'tenant-b' },
      token: 'jwt-token-4',
      lastVerified: 0,
      lastActivity: Date.now(),
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));

    await verifyAdminTokenFn();

    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      'X-Tenant-Id': 'tenant-b',
      Authorization: 'Bearer jwt-token-4',
    });
  });
});

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
    requestHeaders.set('x-tenant-id', 'tenant-b');
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
        'X-Tenant-Id': 'tenant-b',
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

describe('checkOpenIdFn', () => {
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

  it('reports SSO available with auto-redirect off by default', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));

    const result = await checkOpenIdFn();

    expect(result).toEqual({ available: true, ssoOnly: false });
    expect(fetchMock).toHaveBeenCalledWith('http://librechat.test/api/admin/oauth/openid/check', {
      headers: {},
    });
  });

  it('forwards the authoritative tenant when checking OpenID availability', async () => {
    requestHeaders.set('x-tenant-id', 'tenant-b');
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));

    await checkOpenIdFn();

    expect(fetchMock).toHaveBeenCalledWith('http://librechat.test/api/admin/oauth/openid/check', {
      headers: { 'X-Tenant-Id': 'tenant-b' },
    });
  });

  it('marks the session SSO-only when ADMIN_SSO_ONLY=true', async () => {
    process.env.ADMIN_SSO_ONLY = 'true';
    fetchMock.mockResolvedValueOnce(jsonResponse(200, {}));

    const result = await checkOpenIdFn();

    expect(result).toEqual({ available: true, ssoOnly: true });
  });

  it('hides the SSO button without calling the backend when ADMIN_SSO_ENABLED=false', async () => {
    process.env.ADMIN_SSO_ENABLED = 'false';

    const result = await checkOpenIdFn();

    expect(result).toEqual({ available: false, ssoOnly: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets ADMIN_SSO_ENABLED=false take precedence over ADMIN_SSO_ONLY=true', async () => {
    process.env.ADMIN_SSO_ENABLED = 'false';
    process.env.ADMIN_SSO_ONLY = 'true';

    const result = await checkOpenIdFn();

    expect(result).toEqual({ available: false, ssoOnly: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports SSO unavailable when the backend check fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(503, {}));

    const result = await checkOpenIdFn();

    expect(result).toEqual({ available: false, ssoOnly: false });
  });
});
