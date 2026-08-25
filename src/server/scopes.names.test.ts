import { PrincipalType } from 'librechat-data-provider';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BASE_CONFIG_PRINCIPAL_ID } from '@librechat/data-schemas/capabilities';

const IN_WINDOW_GROUP = { _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Group In Window' };
const BEYOND_WINDOW_GROUP = { _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', name: 'Group Beyond Window' };
const DELETED_GROUP_ID = 'cccccccccccccccccccccccc';

/** First page of the capped list endpoint: 200 groups, none of them beyond the window. */
const firstPageGroups = [
  IN_WINDOW_GROUP,
  ...Array.from({ length: 199 }, (_, i) => ({ _id: `filler-${i}`, name: `Filler ${i}` })),
];

const configs = [
  {
    _id: 'cfg-base',
    principalType: PrincipalType.ROLE,
    principalId: BASE_CONFIG_PRINCIPAL_ID,
    priority: 0,
    isActive: true,
    overrides: {},
  },
  {
    _id: 'cfg-role',
    principalType: PrincipalType.ROLE,
    principalId: 'ADMIN',
    priority: 10,
    isActive: true,
    overrides: {},
  },
  {
    _id: 'cfg-group-in-window',
    principalType: PrincipalType.GROUP,
    principalId: IN_WINDOW_GROUP._id,
    priority: 20,
    isActive: true,
    overrides: {},
  },
  {
    _id: 'cfg-group-beyond-window',
    principalType: PrincipalType.GROUP,
    principalId: BEYOND_WINDOW_GROUP._id,
    priority: 20,
    isActive: true,
    overrides: {},
  },
  {
    _id: 'cfg-group-deleted',
    principalType: PrincipalType.GROUP,
    principalId: DELETED_GROUP_ID,
    priority: 20,
    isActive: false,
    overrides: {},
  },
];

const groupsById = new Map(
  [IN_WINDOW_GROUP, BEYOND_WINDOW_GROUP].map((group) => [group._id, group]),
);

function jsonResponse(body: object) {
  return { ok: true, status: 200, json: async () => body };
}

vi.mock('./utils/api', () => ({
  apiFetch: vi.fn(async (url: string) => {
    if (url === '/api/admin/config') return jsonResponse({ configs });
    if (url.startsWith('/api/admin/groups?')) {
      return jsonResponse({ groups: firstPageGroups, total: 1500 });
    }
    const byIdMatch = url.match(/^\/api\/admin\/groups\/([^/?]+)$/);
    const group = byIdMatch ? groupsById.get(byIdMatch[1]) : undefined;
    if (group) return jsonResponse({ group });
    return { ok: false, status: 404, json: async () => ({ error: 'Group not found' }) };
  }),
  extractApiError: vi.fn(async (_res: unknown, msg: string) => {
    throw new Error(msg);
  }),
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator: () => ({
      handler: (fn: (...args: unknown[]) => unknown) => fn,
    }),
    handler: (fn: (...args: unknown[]) => unknown) => fn,
  }),
}));

vi.mock('@tanstack/react-query', () => ({
  queryOptions: (opts: unknown) => opts,
}));

import { getAvailableScopesFn } from './scopes';
import { fetchGroupNamesByIds } from './groups';
import { apiFetch } from './utils/api';
import type * as t from '@/types';

const mockedApiFetch = vi.mocked(apiFetch);

async function getScopesByPrincipalId(): Promise<Map<string, t.ConfigScope>> {
  const { scopes } = await getAvailableScopesFn();
  return new Map(scopes.map((scope) => [scope.principalId, scope]));
}

beforeEach(() => {
  mockedApiFetch.mockClear();
});

describe('getAvailableScopesFn group name resolution', () => {
  it('resolves group scope names beyond the first page of the groups list', async () => {
    const scopes = await getScopesByPrincipalId();
    expect(scopes.get(BEYOND_WINDOW_GROUP._id)?.name).toBe(BEYOND_WINDOW_GROUP.name);
    expect(scopes.get(IN_WINDOW_GROUP._id)?.name).toBe(IN_WINDOW_GROUP.name);
  });

  it('falls back to the principalId when a group cannot be fetched', async () => {
    const scopes = await getScopesByPrincipalId();
    expect(scopes.get(DELETED_GROUP_ID)?.name).toBe(DELETED_GROUP_ID);
  });

  it('excludes the base config and keeps role principalIds as names', async () => {
    const scopes = await getScopesByPrincipalId();
    expect(scopes.has(BASE_CONFIG_PRINCIPAL_ID)).toBe(false);
    expect(scopes.get('ADMIN')?.name).toBe('ADMIN');
  });

  it('fetches names only for group principalIds', async () => {
    await getScopesByPrincipalId();
    const groupFetchUrls = mockedApiFetch.mock.calls
      .map(([url]) => url)
      .filter((url) => url.startsWith('/api/admin/groups'));
    expect(groupFetchUrls.sort()).toEqual(
      [
        `/api/admin/groups/${IN_WINDOW_GROUP._id}`,
        `/api/admin/groups/${BEYOND_WINDOW_GROUP._id}`,
        `/api/admin/groups/${DELETED_GROUP_ID}`,
      ].sort(),
    );
  });
});

describe('fetchGroupNamesByIds', () => {
  it('deduplicates ids and omits failed lookups', async () => {
    const nameMap = await fetchGroupNamesByIds([
      IN_WINDOW_GROUP._id,
      IN_WINDOW_GROUP._id,
      DELETED_GROUP_ID,
    ]);
    expect(nameMap.get(IN_WINDOW_GROUP._id)).toBe(IN_WINDOW_GROUP.name);
    expect(nameMap.has(DELETED_GROUP_ID)).toBe(false);
    expect(mockedApiFetch).toHaveBeenCalledTimes(2);
  });

  it('resolves batches larger than the batch size', async () => {
    const manyIds = Array.from({ length: 30 }, (_, i) => `many-${i}`);
    for (const id of manyIds) {
      groupsById.set(id, { _id: id, name: `Many ${id}` });
    }
    const nameMap = await fetchGroupNamesByIds(manyIds);
    expect(nameMap.size).toBe(30);
    expect(nameMap.get('many-29')).toBe('Many many-29');
    for (const id of manyIds) {
      groupsById.delete(id);
    }
  });
});
