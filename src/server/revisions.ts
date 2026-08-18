import { z } from 'zod';
import { queryOptions } from '@tanstack/react-query';
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start';
import { SystemCapabilities } from '@librechat/data-schemas/capabilities';
import type { AdminConfigResponse } from '@librechat/data-schemas';
import type * as t from '@/types';
import { BASE_CONFIG_PRINCIPAL_ID } from './constants';
import { requireCapability } from './capabilities';
import { useAppSession } from './session';
import { apiFetch } from './utils/api';

export const MAX_CONFIG_REVISIONS = 50;
export const CONFIG_REVISIONS_COLLECTION = 'admin_config_revisions';

let storeOverride: t.RevisionStore | undefined;
let defaultStore: t.RevisionStore | undefined;
let warnedMissingMongo = false;

export function setRevisionStoreForTests(store: t.RevisionStore | undefined): void {
  storeOverride = store;
}

export function createMemoryRevisionStore(): t.RevisionStore {
  const items: t.ConfigRevision[] = [];

  return {
    async insert(revision) {
      items.unshift(revision);
    },
    async list(limit) {
      return items.slice(0, limit).map(toListItem);
    },
    async get(id) {
      return items.find((item) => item.id === id) ?? null;
    },
    async prune(keep) {
      if (items.length > keep) {
        items.length = keep;
      }
    },
  };
}

function toListItem(revision: t.ConfigRevision): t.ConfigRevisionListItem {
  return {
    id: revision.id,
    createdAt: revision.createdAt,
    cause: revision.cause,
    actorId: revision.actorId,
    actorEmail: revision.actorEmail,
  };
}

function mongoUri(): string | undefined {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  return uri && uri.length > 0 ? uri : undefined;
}

function mongoDbName(uri: string): string {
  if (process.env.MONGO_DB_NAME) return process.env.MONGO_DB_NAME;
  try {
    const parsed = new URL(uri.replace(/^mongodb(\+srv)?:/i, 'https:'));
    const fromPath = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    if (fromPath.length > 0) return fromPath;
  } catch {
    /* fall through */
  }
  return 'LibreChat';
}

const getDefaultStore = createServerOnlyFn((): t.RevisionStore => {
  if (defaultStore) return defaultStore;
  const uri = mongoUri();
  if (!uri) {
    if (!warnedMissingMongo) {
      warnedMissingMongo = true;
      console.warn(
        '[revisions] MONGO_URI is unset — config history is in-memory only and will be lost on restart',
      );
    }
    defaultStore = createMemoryRevisionStore();
    return defaultStore;
  }
  defaultStore = createMongoRevisionStore(uri);
  return defaultStore;
});

function getStore(): t.RevisionStore {
  return storeOverride ?? getDefaultStore();
}

function createMongoRevisionStore(uri: string): t.RevisionStore {
  let clientPromise: Promise<import('mongodb').Collection<t.ConfigRevision>> | undefined;

  const collection = async () => {
    if (!clientPromise) {
      clientPromise = (async () => {
        const { MongoClient } = await import('mongodb');
        const client = new MongoClient(uri);
        await client.connect();
        const dbName = mongoDbName(uri);
        return client.db(dbName).collection<t.ConfigRevision>(CONFIG_REVISIONS_COLLECTION);
      })();
    }
    return clientPromise;
  };

  return {
    async insert(revision) {
      const col = await collection();
      await col.insertOne(revision);
    },
    async list(limit) {
      const col = await collection();
      return col
        .find(
          {},
          {
            projection: {
              _id: 0,
              id: 1,
              createdAt: 1,
              cause: 1,
              actorId: 1,
              actorEmail: 1,
            },
            sort: { createdAt: -1 },
            limit,
          },
        )
        .toArray();
    },
    async get(id) {
      const col = await collection();
      return col.findOne({ id });
    },
    async prune(keep) {
      const col = await collection();
      const stale = await col
        .find({}, { projection: { id: 1 }, sort: { createdAt: -1 }, skip: keep })
        .toArray();
      if (stale.length === 0) return;
      await col.deleteMany({ id: { $in: stale.map((doc) => doc.id) } });
    },
  };
}

async function currentActor(): Promise<{ actorId: string; actorEmail?: string }> {
  const session = await useAppSession();
  const user = session.data.user;
  return {
    actorId: user?.id ?? 'unknown',
    actorEmail: user?.email,
  };
}

async function fetchCurrentOverrides(): Promise<Record<string, t.ConfigValue>> {
  const response = await apiFetch(`/api/admin/config/role/${BASE_CONFIG_PRINCIPAL_ID}`);
  if (response.status === 404) {
    return {};
  }
  if (!response.ok) {
    throw new Error(`Failed to snapshot base config: ${response.status}`);
  }
  const body = (await response.json()) as AdminConfigResponse;
  const overrides = body.config?.overrides;
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return {};
  }
  return overrides as Record<string, t.ConfigValue>;
}

export async function snapshotCurrentBaseConfig(cause: t.ConfigRevisionCause): Promise<void> {
  try {
    const [overrides, actor] = await Promise.all([fetchCurrentOverrides(), currentActor()]);
    const revision: t.ConfigRevision = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      cause,
      actorId: actor.actorId,
      actorEmail: actor.actorEmail,
      overrides,
    };
    const store = getStore();
    await store.insert(revision);
    await store.prune(MAX_CONFIG_REVISIONS);
  } catch (error) {
    console.error('[revisions] Failed to snapshot base config before mutate:', error);
  }
}

export const listConfigRevisionsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireCapability(SystemCapabilities.MANAGE_CONFIGS);
  const revisions = await getStore().list(MAX_CONFIG_REVISIONS);
  return { revisions };
});

export const configRevisionsOptions = queryOptions({
  queryKey: ['configRevisions'],
  queryFn: () => listConfigRevisionsFn(),
  staleTime: 10_000,
});

export const restoreConfigRevisionFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireCapability(SystemCapabilities.MANAGE_CONFIGS);
    const revision = await getStore().get(data.id);
    if (!revision) {
      throw new Error('Revision not found');
    }

    await snapshotCurrentBaseConfig('restore');

    const response = await apiFetch(`/api/admin/config/role/${BASE_CONFIG_PRINCIPAL_ID}`, {
      method: 'PUT',
      body: JSON.stringify({ overrides: revision.overrides, priority: 0 }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(
        (err as { error?: string }).error ?? `Failed to restore config: ${response.status}`,
      );
    }

    return { success: true };
  });
