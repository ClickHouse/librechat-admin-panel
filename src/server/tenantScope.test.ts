import { PrincipalType } from 'librechat-data-provider';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.hoisted(() => vi.fn());

vi.mock('./utils/api', () => ({
  apiFetch: apiFetchMock,
  extractApiError: vi.fn(async (_response: Response, message: string) => {
    throw new Error(message);
  }),
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    handler: (handler: (...args: never[]) => unknown) => handler,
    inputValidator: () => ({
      handler: (handler: (...args: never[]) => unknown) => handler,
    }),
  }),
}));

vi.mock('@tanstack/react-query', () => ({
  queryOptions: (options: object) => options,
}));

import { getTenantCapabilitiesFn, grantCapabilityFn } from './capabilities';
import { deleteGroupFn, groupsQueryOptions } from './groups';
import { allRolesQueryOptions, updateRoleFn } from './roles';
import { searchUsersFn, usersQueryOptions } from './users';

describe('tenant-scoped access management', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  it('partitions query keys by effective tenant', () => {
    expect(allRolesQueryOptions('tenant-a').queryKey).not.toEqual(
      allRolesQueryOptions('tenant-b').queryKey,
    );
    expect(groupsQueryOptions('tenant-a').queryKey).not.toEqual(
      groupsQueryOptions('tenant-b').queryKey,
    );
    expect(usersQueryOptions('tenant-a').queryKey).not.toEqual(
      usersQueryOptions('tenant-b').queryKey,
    );
  });

  it('fences cached-state reads and mutations with the expected tenant', async () => {
    apiFetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ role: { _id: '1', name: 'operator', description: 'updated' } }),
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          grant: {
            _id: 'grant-1',
            principalType: PrincipalType.ROLE,
            principalId: 'operator',
            capability: 'read:configs',
          },
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ users: [] }) });

    await updateRoleFn({
      data: {
        id: 'operator',
        description: 'updated',
        expectedTenantId: 'tenant-a',
      },
    });
    await deleteGroupFn({ data: { id: 'group-1', expectedTenantId: 'tenant-a' } });
    await grantCapabilityFn({
      data: {
        principalType: PrincipalType.ROLE,
        principalId: 'operator',
        capability: 'read:configs',
        expectedTenantId: 'tenant-a',
      },
    });
    await searchUsersFn({ data: { query: 'sam', expectedTenantId: 'tenant-a' } });

    expect(apiFetchMock).toHaveBeenCalledTimes(4);
    for (const call of apiFetchMock.mock.calls) {
      expect(call[2]).toBe('tenant-a');
    }
  });

  it('discovers a live tenant switch without returning the new tenant capabilities under the old key', async () => {
    apiFetchMock.mockResolvedValueOnce({
      status: 409,
      json: async () => ({ currentTenantId: 'tenant-b' }),
    });

    await expect(
      getTenantCapabilitiesFn({ data: { expectedTenantId: 'tenant-a' } }),
    ).resolves.toEqual({ tenantChanged: true, currentTenantId: 'tenant-b' });
    expect(apiFetchMock).toHaveBeenCalledWith('/api/admin/grants/effective', undefined, 'tenant-a');
  });
});
