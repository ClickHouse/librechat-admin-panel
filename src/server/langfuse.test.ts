import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.fn();
const requireAllSectionCapabilitiesMock = vi.fn();

vi.mock('./utils/api', () => ({
  apiFetch: (path: string, init?: RequestInit, expectedTenantId?: string) =>
    apiFetchMock(path, init, expectedTenantId),
  extractApiError: vi.fn(async (_response: Response, message: string) => {
    throw new Error(message);
  }),
}));

vi.mock('./capabilities', () => ({
  requireAllSectionCapabilities: (sections: string[]) =>
    requireAllSectionCapabilitiesMock(sections),
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    handler: (fn: (...args: never[]) => unknown) => fn,
    inputValidator: () => ({
      handler: (fn: (...args: never[]) => unknown) => fn,
    }),
  }),
  createServerOnlyFn: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

import {
  getLangfuseConnectionFn,
  testLangfuseConnectionFn,
  updateLangfuseConnectionFn,
} from './langfuse';

const status = {
  configured: true,
  enabled: true,
  configActive: true,
  destinations: [{ key: 'eu', baseUrl: 'https://cloud.langfuse.com' }],
  destination: 'eu',
  publicKey: 'pk-lf-public',
  secretKeyPreview: 'sk-lf-...515f',
  configVersion: 5,
  effectiveTenantId: 'tenant-a',
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAllSectionCapabilitiesMock.mockResolvedValue(undefined);
});

describe('Langfuse connection server functions', () => {
  it('reads connection status through LibreChat', async () => {
    apiFetchMock.mockResolvedValue(new Response(JSON.stringify(status), { status: 200 }));

    await expect(
      getLangfuseConnectionFn({ data: { expectedTenantId: 'tenant-a' } }),
    ).resolves.toEqual(status);
    expect(requireAllSectionCapabilitiesMock).toHaveBeenCalledWith(['langfuse']);
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/admin/langfuse/connection',
      undefined,
      'tenant-a',
    );
  });

  it('updates the connection without exposing or reconstructing a stored secret', async () => {
    apiFetchMock.mockResolvedValue(new Response(JSON.stringify(status), { status: 200 }));
    const data = {
      enabled: false,
      destination: 'eu',
      publicKey: 'pk-lf-public',
      expectedVersion: 5,
      expectedTenantId: 'tenant-a',
    };

    await expect(updateLangfuseConnectionFn({ data })).resolves.toEqual(status);
    expect(requireAllSectionCapabilitiesMock).toHaveBeenCalledWith(['langfuse']);
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/admin/langfuse/connection',
      {
        method: 'PUT',
        body: JSON.stringify(data),
      },
      'tenant-a',
    );
  });

  it('throws a version conflict error when another admin changed the connection first', async () => {
    apiFetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 409 }));
    const data = {
      enabled: false,
      destination: 'eu',
      publicKey: 'pk-lf-public',
      expectedVersion: 5,
      expectedTenantId: 'tenant-a',
    };

    await expect(updateLangfuseConnectionFn({ data })).rejects.toMatchObject({
      name: 'ConfigVersionConflictError',
    });
  });

  it('delegates credential verification to LibreChat', async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: false, message: 'Langfuse rejected these keys' }), {
        status: 200,
      }),
    );
    const data = {
      destination: 'eu',
      publicKey: 'pk-lf-public',
      secretKey: 'sk-lf-secret',
      expectedTenantId: 'tenant-a',
    };

    await expect(testLangfuseConnectionFn({ data })).resolves.toEqual({
      success: false,
      message: 'Langfuse rejected these keys',
    });
    expect(requireAllSectionCapabilitiesMock).toHaveBeenCalledWith(['langfuse']);
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/admin/langfuse/connection/test',
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
      'tenant-a',
    );
  });
});
