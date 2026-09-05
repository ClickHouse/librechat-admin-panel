import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  configRevisionsOptions,
  listConfigRevisionsFn,
  readAuthenticatedBaseConfigSnapshot,
  restoreConfigRevisionFn,
} from './revisions';
import { isVersionConflictError } from './utils/errors';

const { apiFetchMock, requireCapabilityMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  requireCapabilityMock: vi.fn(),
}));

vi.mock('./utils/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./utils/api')>()),
  apiFetch: apiFetchMock,
}));

vi.mock('./capabilities', () => ({
  requireCapability: requireCapabilityMock,
}));

vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => ({
    inputValidator: () => ({
      handler: <T>(fn: T) => fn,
    }),
  }),
}));

const revisionId = '11111111-1111-4111-8111-111111111111';
const tenantId = 'tenant-a';

function jsonResponse(status: number, body: object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  apiFetchMock.mockReset();
  requireCapabilityMock.mockReset();
  requireCapabilityMock.mockResolvedValue(undefined);
});

describe('restoreConfigRevisionFn', () => {
  it.each([null, 0, 4])(
    'forwards the frozen version %s and tenant in one atomic request',
    async (expectedVersion) => {
      apiFetchMock.mockResolvedValue(jsonResponse(200, { changed: true }));
      await expect(
        restoreConfigRevisionFn({
          data: { id: revisionId, expectedVersion, expectedTenantId: tenantId },
        }),
      ).resolves.toEqual({ success: true });

      expect(apiFetchMock).toHaveBeenCalledExactlyOnceWith(
        '/api/admin/config/role/__base__/atomic',
        {
          method: 'POST',
          body: JSON.stringify({
            expectedVersion,
            expectedTenantId: tenantId,
            cause: 'restore',
            restoreRevisionId: revisionId,
          }),
        },
        tenantId,
      );
    },
  );

  it('preserves an identifiable conflict across the server-function boundary', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse(409, { error: 'Config version conflict' }));
    const error = await restoreConfigRevisionFn({
      data: { id: revisionId, expectedVersion: 4, expectedTenantId: tenantId },
    }).catch((caught: Error) => caught);
    expect(isVersionConflictError(error)).toBe(true);
  });

  it.each([
    [404, 'Revision not found'],
    [503, 'Transactions are required'],
  ])('propagates backend rejection %s without a second write', async (status, error) => {
    apiFetchMock.mockResolvedValue(jsonResponse(Number(status), { error }));
    await expect(
      restoreConfigRevisionFn({
        data: { id: revisionId, expectedVersion: 4, expectedTenantId: tenantId },
      }),
    ).rejects.toThrow(String(error));
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });

  it('checks capability before contacting the backend', async () => {
    requireCapabilityMock.mockRejectedValue(new Error('Insufficient permissions'));
    await expect(
      restoreConfigRevisionFn({
        data: { id: revisionId, expectedVersion: 4, expectedTenantId: tenantId },
      }),
    ).rejects.toThrow('Insufficient permissions');
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});

describe('backend-scoped revision reads', () => {
  it('reads the indexed-array merge baseline from the authenticated response', async () => {
    apiFetchMock.mockResolvedValue(
      jsonResponse(200, {
        dbOverrides: { endpoints: { custom: [{ name: 'endpoint-a' }] } },
        dbConfigVersion: 7,
        effectiveTenantId: tenantId,
      }),
    );
    await expect(readAuthenticatedBaseConfigSnapshot(tenantId)).resolves.toEqual({
      overrides: { endpoints: { custom: [{ name: 'endpoint-a' }] } },
      absent: false,
      configVersion: 7,
      effectiveTenantId: tenantId,
    });
    expect(apiFetchMock).toHaveBeenCalledExactlyOnceWith(
      '/api/admin/config/base',
      undefined,
      tenantId,
    );
  });

  it('represents an absent base without inventing a version', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse(200, { effectiveTenantId: tenantId }));
    await expect(readAuthenticatedBaseConfigSnapshot(tenantId)).resolves.toEqual({
      overrides: {},
      absent: true,
      configVersion: null,
      effectiveTenantId: tenantId,
    });
  });

  it('requires the effective tenant on snapshot and history responses', async () => {
    apiFetchMock.mockImplementation(async () => jsonResponse(200, {}));
    await expect(readAuthenticatedBaseConfigSnapshot(tenantId)).rejects.toThrow('effective tenant');
    await expect(listConfigRevisionsFn({ data: { expectedTenantId: tenantId } })).rejects.toThrow(
      'effective tenant',
    );
  });

  it('lists only through the tenant-guarded backend API', async () => {
    const revisions = [
      {
        id: revisionId,
        createdAt: '2026-09-04T00:00:00.000Z',
        cause: 'save',
        actorId: 'admin-a',
      },
    ];
    apiFetchMock.mockResolvedValue(jsonResponse(200, { effectiveTenantId: tenantId, revisions }));
    await expect(listConfigRevisionsFn({ data: { expectedTenantId: tenantId } })).resolves.toEqual({
      effectiveTenantId: tenantId,
      revisions,
    });
    expect(apiFetchMock).toHaveBeenCalledExactlyOnceWith(
      '/api/admin/config/role/__base__/revisions',
      undefined,
      tenantId,
    );
  });

  it('does not list revisions without capability', async () => {
    requireCapabilityMock.mockRejectedValue(new Error('Insufficient permissions'));
    await expect(listConfigRevisionsFn({ data: { expectedTenantId: tenantId } })).rejects.toThrow(
      'Insufficient permissions',
    );
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('surfaces failed reads instead of returning an empty snapshot or history', async () => {
    apiFetchMock.mockImplementation(async () =>
      jsonResponse(503, { error: 'Backend unavailable' }),
    );
    await expect(readAuthenticatedBaseConfigSnapshot(tenantId)).rejects.toThrow(
      'Backend unavailable',
    );
    await expect(listConfigRevisionsFn({ data: { expectedTenantId: tenantId } })).rejects.toThrow(
      'Backend unavailable',
    );
  });

  it('keeps history queries disabled until the tenant is known', () => {
    expect(configRevisionsOptions('admin-a').enabled).toBe(false);
    expect(configRevisionsOptions('admin-a', tenantId).queryKey).toEqual([
      'configRevisions',
      tenantId,
      'admin-a',
    ]);
  });
});
