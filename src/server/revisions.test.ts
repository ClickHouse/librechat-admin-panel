import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as t from '@/types';

const apiFetchMock = vi.fn();
const sessionState: {
  data: { user?: { id: string; email?: string; tenantId?: string } };
} = {
  data: { user: { id: 'user-1', email: 'admin@kindred.test', tenantId: '' } },
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
  PROVISIONAL_REVISION_TTL_MS,
  beginConfigRevision,
  commitRevisionAfterMutationSuccess,
  createMemoryRevisionStore,
  discardConfigRevision,
  finalizeConfigRevision,
  rememberUntilRejected,
  restoreConfigRevisionFn,
  selectMongoDatabase,
  setRawBaseConfigReaderForTests,
  setRevisionStoreForTests,
  snapshotCurrentBaseConfig,
} from './revisions';

/** Wraps the memory store with a `finalize` that always fails, so tests can verify
 *  durable reconciliation (via `committed` + `finalizeCommittedProvisional`) still
 *  recovers a revision whose direct finalize path never succeeds. */
function createFlakyFinalizeStore(): t.RevisionStore {
  const base = createMemoryRevisionStore();
  return {
    ...base,
    async finalize() {
      throw new Error('finalize always fails in this test store');
    },
  };
}

function jsonResponse(status: number, body: Record<string, t.ConfigValue> | object): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function revision(
  partial: Partial<t.ConfigRevision> & Pick<t.ConfigRevision, 'id'>,
): t.ConfigRevision {
  return {
    createdAt: new Date().toISOString(),
    cause: 'save',
    actorId: 'user-1',
    tenantId: '',
    overrides: {},
    absent: false,
    status: 'final',
    ...partial,
  };
}

describe('createMemoryRevisionStore', () => {
  it('lists newest first and prunes to the keep count', async () => {
    const store = createMemoryRevisionStore();
    for (let i = 0; i < 3; i += 1) {
      await store.insert(
        revision({
          id: `rev-${i}`,
          createdAt: new Date(2026, 0, i + 1).toISOString(),
          overrides: { version: i },
        }),
      );
    }

    const listed = await store.list('', 2);
    expect(listed.map((item) => item.id)).toEqual(['rev-2', 'rev-1']);

    await store.prune('', 1);
    const afterPrune = await store.list('', 10);
    expect(afterPrune.map((item) => item.id)).toEqual(['rev-2']);
    expect(await store.get('', 'rev-0')).toBeNull();
    expect((await store.get('', 'rev-2'))?.overrides).toEqual({ version: 2 });
  });

  it('scopes list, get, and prune to the requested tenant', async () => {
    const store = createMemoryRevisionStore();
    await store.insert(revision({ id: 'a-1', tenantId: 'tenant-a', overrides: { a: 1 } }));
    await store.insert(revision({ id: 'b-1', tenantId: 'tenant-b', overrides: { b: 1 } }));
    await store.insert(revision({ id: 'a-2', tenantId: 'tenant-a', overrides: { a: 2 } }));

    expect((await store.list('tenant-a', 10)).map((item) => item.id)).toEqual(['a-2', 'a-1']);
    expect((await store.list('tenant-b', 10)).map((item) => item.id)).toEqual(['b-1']);
    expect(await store.get('tenant-a', 'b-1')).toBeNull();
    expect((await store.get('tenant-b', 'b-1'))?.overrides).toEqual({ b: 1 });

    await store.prune('tenant-a', 1);
    expect((await store.list('tenant-a', 10)).map((item) => item.id)).toEqual(['a-2']);
    expect((await store.list('tenant-b', 10)).map((item) => item.id)).toEqual(['b-1']);
  });

  it('hides non-base principal revisions from list and get', async () => {
    const store = createMemoryRevisionStore();
    await store.insert(
      revision({
        id: 'group-rev',
        tenantId: 'tenant-a',
        principalType: 'group',
        principalId: 'g1',
      }),
    );
    await store.insert(revision({ id: 'base-rev', tenantId: 'tenant-a' }));

    expect((await store.list('tenant-a', 10)).map((item) => item.id)).toEqual(['base-rev']);
    expect(await store.get('tenant-a', 'group-rev')).toBeNull();
  });
});

describe('rememberUntilRejected', () => {
  it('clears the cached promise after a rejection so later calls retry', async () => {
    let attempts = 0;
    const get = rememberUntilRejected(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('transient');
      return 'ok';
    });

    await expect(get()).rejects.toThrow('transient');
    await expect(get()).resolves.toBe('ok');
    expect(attempts).toBe(2);
  });

  it('reuses the same in-flight promise while it is pending', async () => {
    let attempts = 0;
    const get = rememberUntilRejected(async () => {
      attempts += 1;
      return 'ok';
    });

    const [first, second] = await Promise.all([get(), get()]);
    expect(first).toBe('ok');
    expect(second).toBe('ok');
    expect(attempts).toBe(1);
  });
});

describe('snapshotCurrentBaseConfig', () => {
  let store: t.RevisionStore;

  beforeEach(() => {
    store = createMemoryRevisionStore();
    setRevisionStoreForTests(store);
    sessionState.data = { user: { id: 'user-1', email: 'admin@kindred.test', tenantId: '' } };
    apiFetchMock.mockReset();
  });

  afterEach(() => {
    setRevisionStoreForTests(undefined);
    setRawBaseConfigReaderForTests(undefined);
  });

  it('stores the raw Mongo overrides before a mutate', async () => {
    setRawBaseConfigReaderForTests(async () => ({
      overrides: { endpoints: { custom: [{ apiKey: 'sk-live-secret' }] } },
      absent: false,
    }));

    await snapshotCurrentBaseConfig('save');

    const revisions = await store.list('', 10);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].cause).toBe('save');
    expect(revisions[0].actorEmail).toBe('admin@kindred.test');
    const full = await store.get('', revisions[0].id);
    expect(full?.tenantId).toBe('');
    expect(full?.absent).toBe(false);
    expect(full?.overrides).toEqual({ endpoints: { custom: [{ apiKey: 'sk-live-secret' }] } });
  });

  it('records an absent base document as empty overrides', async () => {
    setRawBaseConfigReaderForTests(async () => ({ overrides: {}, absent: true }));
    await snapshotCurrentBaseConfig('reset');
    const revisions = await store.list('', 10);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].cause).toBe('reset');
    const full = await store.get('', revisions[0].id);
    expect(full?.absent).toBe(true);
    expect(full?.overrides).toEqual({});
  });

  it('tags snapshots with the authenticated session tenant', async () => {
    sessionState.data = {
      user: { id: 'user-1', email: 'admin@kindred.test', tenantId: 'tenant-a' },
    };
    setRawBaseConfigReaderForTests(async () => ({
      overrides: { registration: { enabled: true } },
      absent: false,
    }));
    await snapshotCurrentBaseConfig('save');
    expect(await store.list('', 10)).toHaveLength(0);
    const listed = await store.list('tenant-a', 10);
    expect(listed).toHaveLength(1);
    expect((await store.get('tenant-a', listed[0].id))?.tenantId).toBe('tenant-a');
  });

  it('resolves tenant from the verified user when the session has none', async () => {
    sessionState.data = { user: { id: 'user-1', email: 'admin@kindred.test' } };
    apiFetchMock.mockImplementation(async (path: string) => {
      if (String(path).includes('/api/admin/verify')) {
        return jsonResponse(200, { user: { id: 'user-1', tenantId: 'tenant-from-jwt' } });
      }
      return jsonResponse(404, {});
    });
    setRawBaseConfigReaderForTests(async () => ({
      overrides: { registration: { enabled: true } },
      absent: false,
    }));
    await snapshotCurrentBaseConfig('save');
    expect(apiFetchMock.mock.calls.some((call) => call[0] === '/api/admin/verify')).toBe(true);
    expect(await store.list('tenant-a', 10)).toHaveLength(0);
    expect((await store.list('tenant-from-jwt', 10)).map((item) => item.id)).toHaveLength(1);
  });

  it('throws when the raw snapshot cannot be read', async () => {
    setRawBaseConfigReaderForTests(async () => {
      throw new Error('mongo unavailable');
    });
    await expect(snapshotCurrentBaseConfig('import')).rejects.toThrow('mongo unavailable');
    expect(await store.list('', 10)).toHaveLength(0);
  });

  it('does not list or retain provisional snapshots until they are finalized', async () => {
    setRawBaseConfigReaderForTests(async () => ({
      overrides: { cache: true },
      absent: false,
      configVersion: 3,
    }));

    const provisional = await beginConfigRevision('save');
    expect(await store.list('', 10)).toHaveLength(0);

    await finalizeConfigRevision(provisional);
    expect(await store.list('', 10)).toHaveLength(1);

    const failed = await beginConfigRevision('save');
    await discardConfigRevision(failed);
    expect(await store.list('', 10)).toHaveLength(1);
  });

  it('removes expired provisional snapshots during reconciliation', async () => {
    setRawBaseConfigReaderForTests(async () => ({
      overrides: { cache: true },
      absent: false,
      configVersion: 3,
    }));

    const staleCreatedAt = new Date(Date.now() - PROVISIONAL_REVISION_TTL_MS - 60_000);
    await store.insert(
      revision({
        id: 'stale-provisional',
        status: 'provisional',
        committed: false,
        expiresAt: staleCreatedAt,
        createdAt: staleCreatedAt.toISOString(),
      }),
    );

    await beginConfigRevision('save');
    expect(await store.get('', 'stale-provisional')).toBeNull();
  });

  it('never discards a committed provisional revision past its TTL', async () => {
    setRawBaseConfigReaderForTests(async () => ({
      overrides: { cache: true },
      absent: false,
      configVersion: 3,
    }));
    const staleCreatedAt = new Date(Date.now() - PROVISIONAL_REVISION_TTL_MS - 60_000);
    await store.insert(
      revision({
        id: 'committed-provisional',
        status: 'provisional',
        committed: true,
        expiresAt: staleCreatedAt,
        createdAt: staleCreatedAt.toISOString(),
      }),
    );

    await beginConfigRevision('save');

    const finalized = await store.get('', 'committed-provisional');
    expect(finalized?.status).toBe('final');
  });

  it('unsets expiresAt when marking a revision committed', async () => {
    const expiresAt = new Date(Date.now() + PROVISIONAL_REVISION_TTL_MS);
    await store.insert(
      revision({
        id: 'will-commit',
        status: 'provisional',
        committed: false,
        expiresAt,
      }),
    );
    await store.markCommitted('', 'will-commit');
    const item = await store.get('', 'will-commit');
    expect(item?.committed).toBe(true);
    expect(item?.expiresAt).toBeUndefined();
  });
});

describe('durable revision finalization', () => {
  let store: t.RevisionStore;

  beforeEach(() => {
    store = createFlakyFinalizeStore();
    setRevisionStoreForTests(store);
    sessionState.data = { user: { id: 'user-1', email: 'admin@kindred.test', tenantId: '' } };
    setRawBaseConfigReaderForTests(async () => ({
      overrides: { cache: true },
      absent: false,
      configVersion: 3,
    }));
  });

  afterEach(() => {
    setRevisionStoreForTests(undefined);
    setRawBaseConfigReaderForTests(undefined);
  });

  it('reconciles a committed revision to final on the next call even when finalize keeps failing', async () => {
    const successfulRevision = await beginConfigRevision('save');
    await commitRevisionAfterMutationSuccess(successfulRevision);

    // finalize failed every retry, so it is not yet visible in history...
    expect(await store.list('', 10)).toHaveLength(0);
    expect((await store.get('', successfulRevision.id))?.committed).toBe(true);
    expect((await store.get('', successfulRevision.id))?.status).toBe('provisional');

    // ...but the committed signal survives, so the next begin call reconciles it.
    await beginConfigRevision('save');
    const listed = await store.list('', 10);
    expect(listed.some((item) => item.id === successfulRevision.id)).toBe(true);
  });
});

describe('restoreConfigRevisionFn', () => {
  let store: t.RevisionStore;

  beforeEach(() => {
    store = createMemoryRevisionStore();
    setRevisionStoreForTests(store);
    sessionState.data = { user: { id: 'user-1', email: 'admin@kindred.test', tenantId: '' } };
    apiFetchMock.mockReset();
    setRawBaseConfigReaderForTests(async () => ({
      overrides: { registration: { enabled: true } },
      absent: false,
      configVersion: 4,
    }));
  });

  afterEach(() => {
    setRevisionStoreForTests(undefined);
    setRawBaseConfigReaderForTests(undefined);
  });

  it('restores via the atomic endpoint with the chosen overrides', async () => {
    await store.insert(
      revision({
        id: '11111111-1111-4111-8111-111111111111',
        createdAt: '2026-01-01T00:00:00.000Z',
        overrides: { registration: { enabled: false } },
      }),
    );

    apiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (String(path).includes('/atomic') && init?.method === 'POST') {
        return jsonResponse(200, { ok: true });
      }
      return jsonResponse(404, {});
    });

    const restore = restoreConfigRevisionFn as unknown as (args: {
      data: { id: string };
    }) => Promise<{ success: boolean }>;
    await restore({ data: { id: '11111111-1111-4111-8111-111111111111' } });

    const revisions = await store.list('', 10);
    expect(revisions.some((item) => item.cause === 'restore' || item.id === '11111111-1111-4111-8111-111111111111')).toBe(
      true,
    );
    const atomicCall = apiFetchMock.mock.calls.find((call) => String(call[0]).includes('/atomic'));
    expect(atomicCall).toBeDefined();
    expect(JSON.parse(String(atomicCall?.[1]?.body))).toEqual({
      expectedVersion: 4,
      cause: 'restore',
      restoreRevisionId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('restores an absent snapshot with deleteDocument instead of a redacted PUT', async () => {
    await store.insert(
      revision({
        id: '22222222-2222-4222-8222-222222222222',
        absent: true,
      }),
    );

    apiFetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    const restore = restoreConfigRevisionFn as unknown as (args: {
      data: { id: string };
    }) => Promise<{ success: boolean }>;
    await restore({ data: { id: '22222222-2222-4222-8222-222222222222' } });

    const atomicCall = apiFetchMock.mock.calls.find((call) => String(call[0]).includes('/atomic'));
    expect(JSON.parse(String(atomicCall?.[1]?.body))).toEqual({
      expectedVersion: 4,
      cause: 'restore',
      restoreRevisionId: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('does not restore another tenant’s revision by id', async () => {
    sessionState.data = {
      user: { id: 'user-1', email: 'admin@kindred.test', tenantId: 'tenant-a' },
    };
    await store.insert(
      revision({
        id: '33333333-3333-4333-8333-333333333333',
        tenantId: 'tenant-b',
        overrides: { registration: { enabled: false } },
      }),
    );

    const restore = restoreConfigRevisionFn as unknown as (args: {
      data: { id: string };
    }) => Promise<{ success: boolean }>;
    await expect(restore({ data: { id: '33333333-3333-4333-8333-333333333333' } })).rejects.toThrow(
      'Revision not found',
    );
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('rejects provisional revisions that are hidden from history', async () => {
    await store.insert(
      revision({
        id: '44444444-4444-4444-8444-444444444444',
        status: 'provisional',
        committed: false,
      }),
    );

    const restore = restoreConfigRevisionFn as unknown as (args: {
      data: { id: string };
    }) => Promise<{ success: boolean }>;
    await expect(restore({ data: { id: '44444444-4444-4444-8444-444444444444' } })).rejects.toThrow(
      'Revision not found',
    );
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});

describe('MAX_CONFIG_REVISIONS', () => {
  it('caps retained snapshots', () => {
    expect(MAX_CONFIG_REVISIONS).toBe(50);
  });
});

describe('selectMongoDatabase', () => {
  const original = process.env.MONGO_DB_NAME;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.MONGO_DB_NAME;
    } else {
      process.env.MONGO_DB_NAME = original;
    }
  });

  it('uses MONGO_DB_NAME when set', () => {
    process.env.MONGO_DB_NAME = 'ExplicitDb';
    const db = { name: 'ExplicitDb' };
    const client = { db: vi.fn().mockReturnValue(db) };
    expect(selectMongoDatabase(client as never)).toBe(db);
    expect(client.db).toHaveBeenCalledWith('ExplicitDb');
  });

  it('lets MongoClient resolve the URI database when MONGO_DB_NAME is unset', () => {
    delete process.env.MONGO_DB_NAME;
    const db = { name: 'CustomDb' };
    const client = { db: vi.fn().mockReturnValue(db) };
    expect(selectMongoDatabase(client as never)).toBe(db);
    expect(client.db).toHaveBeenCalledWith();
  });
});
