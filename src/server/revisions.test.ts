import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as t from '@/types';

const apiFetchMock = vi.fn();
const sessionState: { data: { user?: { id: string; email?: string } } } = {
  data: { user: { id: 'user-1', email: 'admin@kindred.test' } },
};

vi.mock('./utils/api', () => ({
  apiFetch: (path: string, init?: RequestInit) => apiFetchMock(path, init),
}));

vi.mock('./session', () => ({
  useAppSession: vi.fn(async () => ({
    data: sessionState.data,
  })),
}));

vi.mock('./capabilities', () => ({
  requireCapability: vi.fn(async () => undefined),
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    handler: (fn: (...args: unknown[]) => unknown) => fn,
    inputValidator: () => ({
      handler: (fn: (...args: unknown[]) => unknown) => fn,
    }),
  }),
  createServerOnlyFn: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

vi.mock('@tanstack/react-query', () => ({
  queryOptions: (opts: unknown) => opts,
}));

import {
  MAX_CONFIG_REVISIONS,
  createMemoryRevisionStore,
  restoreConfigRevisionFn,
  setRevisionStoreForTests,
  snapshotCurrentBaseConfig,
} from './revisions';

function jsonResponse(status: number, body: Record<string, t.ConfigValue> | object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('createMemoryRevisionStore', () => {
  it('lists newest first and prunes to the keep count', async () => {
    const store = createMemoryRevisionStore();
    for (let i = 0; i < 3; i += 1) {
      await store.insert({
        id: `rev-${i}`,
        createdAt: new Date(2026, 0, i + 1).toISOString(),
        cause: 'save',
        actorId: 'user-1',
        overrides: { version: i },
      });
    }

    const listed = await store.list(2);
    expect(listed.map((item) => item.id)).toEqual(['rev-2', 'rev-1']);

    await store.prune(1);
    const afterPrune = await store.list(10);
    expect(afterPrune.map((item) => item.id)).toEqual(['rev-2']);
    expect(await store.get('rev-0')).toBeNull();
    expect((await store.get('rev-2'))?.overrides).toEqual({ version: 2 });
  });
});

describe('snapshotCurrentBaseConfig', () => {
  let store: t.RevisionStore;

  beforeEach(() => {
    store = createMemoryRevisionStore();
    setRevisionStoreForTests(store);
    sessionState.data = { user: { id: 'user-1', email: 'admin@kindred.test' } };
    apiFetchMock.mockReset();
  });

  afterEach(() => {
    setRevisionStoreForTests(undefined);
  });

  it('stores the current DB overrides before a mutate', async () => {
    apiFetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        config: { overrides: { interface: { privacyPolicy: { enabled: true } } } },
      }),
    );

    await snapshotCurrentBaseConfig('save');

    const revisions = await store.list(10);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].cause).toBe('save');
    expect(revisions[0].actorEmail).toBe('admin@kindred.test');
    const full = await store.get(revisions[0].id);
    expect(full?.overrides).toEqual({ interface: { privacyPolicy: { enabled: true } } });
  });

  it('treats a missing base document as empty overrides', async () => {
    apiFetchMock.mockResolvedValueOnce(jsonResponse(404, {}));
    await snapshotCurrentBaseConfig('reset');
    const revisions = await store.list(10);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].cause).toBe('reset');
    expect((await store.get(revisions[0].id))?.overrides).toEqual({});
  });

  it('does not throw when the snapshot fetch fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    apiFetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'boom' }));
    await expect(snapshotCurrentBaseConfig('import')).resolves.toBeUndefined();
    expect(await store.list(10)).toHaveLength(0);
    errorSpy.mockRestore();
  });
});

describe('restoreConfigRevisionFn', () => {
  let store: t.RevisionStore;

  beforeEach(() => {
    store = createMemoryRevisionStore();
    setRevisionStoreForTests(store);
    apiFetchMock.mockReset();
  });

  afterEach(() => {
    setRevisionStoreForTests(undefined);
  });

  it('snapshots current overrides then PUTs the chosen revision', async () => {
    await store.insert({
      id: '11111111-1111-4111-8111-111111111111',
      createdAt: '2026-01-01T00:00:00.000Z',
      cause: 'save',
      actorId: 'user-1',
      overrides: { registration: { enabled: false } },
    });

    apiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return jsonResponse(200, { ok: true });
      }
      if (String(path).includes('/api/admin/config/role/')) {
        return jsonResponse(200, { config: { overrides: { registration: { enabled: true } } } });
      }
      return jsonResponse(404, {});
    });

    const restore = restoreConfigRevisionFn as unknown as (args: {
      data: { id: string };
    }) => Promise<{ success: boolean }>;
    await restore({ data: { id: '11111111-1111-4111-8111-111111111111' } });

    const revisions = await store.list(10);
    expect(revisions[0].cause).toBe('restore');
    const putCall = apiFetchMock.mock.calls.find((call) => call[1]?.method === 'PUT');
    expect(putCall).toBeDefined();
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual({
      overrides: { registration: { enabled: false } },
      priority: 0,
    });
  });
});

describe('MAX_CONFIG_REVISIONS', () => {
  it('caps retained snapshots', () => {
    expect(MAX_CONFIG_REVISIONS).toBe(50);
  });
});
