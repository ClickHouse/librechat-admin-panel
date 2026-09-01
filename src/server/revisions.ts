import { z } from 'zod';
import { queryOptions } from '@tanstack/react-query';
import { PrincipalType } from 'librechat-data-provider';
import { SystemCapabilities } from '@librechat/data-schemas/capabilities';
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start';
import type { Collection, Db, MongoClient } from 'mongodb';
import type * as t from '@/types';
import { BASE_CONFIG_PRINCIPAL_ID } from './constants';
import { requireCapability } from './capabilities';
import { useAppSession } from './session';
import { apiFetch } from './utils/api';

export const MAX_CONFIG_REVISIONS = 50;
export const PROVISIONAL_REVISION_TTL_MS = 60 * 60 * 1000;
export const CONFIG_REVISIONS_COLLECTION = 'admin_config_revisions';
export const CONFIGS_COLLECTION = 'configs';

const RETRY_BACKOFF_MS = [100, 300];

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retries a transient operation with short backoff; throws the final error if all attempts fail. */
async function retryWithBackoff<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < RETRY_BACKOFF_MS.length) await sleep(RETRY_BACKOFF_MS[attempt]);
    }
  }
  throw lastError;
}

let storeOverride: t.RevisionStore | undefined;
let defaultStore: t.RevisionStore | undefined;
let rawReaderOverride: (() => Promise<t.RawBaseConfigSnapshot>) | undefined;

export function setRevisionStoreForTests(store: t.RevisionStore | undefined): void {
  storeOverride = store;
}

export function setRawBaseConfigReaderForTests(
  reader: (() => Promise<t.RawBaseConfigSnapshot>) | undefined,
): void {
  rawReaderOverride = reader;
}

/** Caches a promise until it rejects so a later call can retry the factory. */
export function rememberUntilRejected<T>(factory: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    if (!pending) {
      pending = factory().catch((error: unknown) => {
        pending = undefined;
        throw error;
      });
    }
    return pending;
  };
}

function isFinalizedRevision(revision: t.ConfigRevision): boolean {
  return revision.status !== 'provisional';
}

export function createMemoryRevisionStore(): t.RevisionStore {
  const items: t.ConfigRevision[] = [];

  return {
    async insert(revision) {
      items.unshift(revision);
    },
    async list(tenantId, limit) {
      return items
        .filter(
          (item) => item.tenantId === tenantId && isFinalizedRevision(item) && isBaseRevision(item),
        )
        .slice(0, limit)
        .map(toListItem);
    },
    async get(tenantId, id) {
      return (
        items.find(
          (item) => item.tenantId === tenantId && item.id === id && isBaseRevision(item),
        ) ?? null
      );
    },
    async prune(tenantId, keep) {
      const tenantItems = items.filter(
        (item) => item.tenantId === tenantId && isBaseRevision(item),
      );
      const finalized = tenantItems.filter(isFinalizedRevision);
      const provisional = tenantItems.filter((item) => !isFinalizedRevision(item));
      const keepFinalized = finalized.slice(0, keep);
      const others = items.filter((item) => item.tenantId !== tenantId || !isBaseRevision(item));
      items.length = 0;
      items.push(...keepFinalized, ...provisional, ...others);
    },
    async finalize(tenantId, id) {
      const item = items.find((entry) => entry.tenantId === tenantId && entry.id === id);
      if (!item) return;
      item.status = 'final';
    },
    async discard(tenantId, id) {
      const index = items.findIndex(
        (entry) => entry.tenantId === tenantId && entry.id === id && entry.status === 'provisional',
      );
      if (index >= 0) items.splice(index, 1);
    },
    async markCommitted(tenantId, id) {
      const item = items.find((entry) => entry.tenantId === tenantId && entry.id === id);
      if (!item) return;
      item.committed = true;
      delete item.expiresAt;
    },
    async finalizeCommittedProvisional(tenantId) {
      for (const item of items) {
        if (item.tenantId === tenantId && item.status === 'provisional' && item.committed) {
          item.status = 'final';
        }
      }
    },
    async discardStaleProvisional(tenantId, before) {
      const cutoff = before.getTime();
      for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (item.tenantId !== tenantId || item.status !== 'provisional' || item.committed !== false)
          continue;
        if (!item.expiresAt) continue;
        if (item.expiresAt.getTime() < cutoff) items.splice(index, 1);
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

export function selectMongoDatabase(client: MongoClient): Db {
  const name = process.env.MONGO_DB_NAME;
  if (typeof name === 'string' && name.length > 0) {
    return client.db(name);
  }
  return client.db();
}

interface RawConfigDoc {
  principalType: string;
  principalId: string;
  tenantId?: string | null;
  overrides?: Record<string, t.ConfigValue> | null;
  configVersion?: number | null;
}

interface MongoHandle {
  revisions: Collection<t.ConfigRevision>;
  configs: Collection<RawConfigDoc>;
}

let indexesEnsured = false;

/** BSON TTL indexes only expire `Date` values; `expiresAt` must never be stored as a string. */
async function ensureRevisionIndexes(revisions: Collection<t.ConfigRevision>): Promise<void> {
  if (indexesEnsured) return;
  try {
    await revisions.dropIndex('expiresAt_1');
  } catch {
    /* previous TTL index may not exist */
  }
  await revisions.createIndex(
    { expiresAt: 1 },
    {
      name: 'provisional_uncommitted_ttl',
      expireAfterSeconds: 0,
      partialFilterExpression: { status: 'provisional', committed: false },
    },
  );
  indexesEnsured = true;
}

function tenantKey(value: string | undefined | null): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function authenticatedTenantId(): Promise<string> {
  const session = await useAppSession();
  const fromSession = session.data.user?.tenantId;
  if (typeof fromSession === 'string') return tenantKey(fromSession);

  const response = await apiFetch('/api/admin/verify');
  if (!response.ok) {
    throw new Error(`Failed to resolve tenant: ${response.status}`);
  }
  const body = (await response.json()) as { user?: { tenantId?: string } };
  return tenantKey(body.user?.tenantId);
}

const connectMongoHandle = createServerOnlyFn(
  rememberUntilRejected(async (): Promise<MongoHandle> => {
    const uri = mongoUri();
    if (!uri) {
      throw new Error('MONGO_URI is required for configuration history');
    }
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(uri);
    await client.connect();
    try {
      const db = selectMongoDatabase(client);
      const revisions = db.collection<t.ConfigRevision>(CONFIG_REVISIONS_COLLECTION);
      await ensureRevisionIndexes(revisions);
      return {
        revisions,
        configs: db.collection<RawConfigDoc>(CONFIGS_COLLECTION),
      };
    } catch (err) {
      await client.close();
      throw err;
    }
  }),
);

const getDefaultStore = createServerOnlyFn((): t.RevisionStore => {
  if (defaultStore) return defaultStore;
  defaultStore = createMongoRevisionStore();
  return defaultStore;
});

function getStore(): t.RevisionStore {
  return storeOverride ?? getDefaultStore();
}

function tenantFilter(tenantId: string): Record<string, unknown> {
  if (tenantId.length > 0) {
    return { tenantId };
  }
  return { $or: [{ tenantId: { $exists: false } }, { tenantId: null }, { tenantId: '' }] };
}

function baseRevisionFilter(tenantId: string): Record<string, unknown> {
  return {
    $and: [
      tenantFilter(tenantId),
      {
        $or: [
          { principalType: PrincipalType.ROLE, principalId: BASE_CONFIG_PRINCIPAL_ID },
          {
            principalType: { $exists: false },
            principalId: { $exists: false },
          },
        ],
      },
    ],
  };
}

function isBaseRevision(item: t.ConfigRevision): boolean {
  if (item.principalType == null && item.principalId == null) return true;
  return item.principalType === PrincipalType.ROLE && item.principalId === BASE_CONFIG_PRINCIPAL_ID;
}

/**
 * Durable reconciliation for provisional revisions, run on every begin/list:
 * - Revisions whose mutation is known to have committed (see `markCommitted`) are
 *   finalized regardless of age — they are safe rollback points, never garbage.
 * - Revisions that never got a committed signal and are past their TTL are
 *   abandoned attempts (crash before the mutation ran, or an already-handled
 *   failure) and are discarded.
 */
async function reconcileStaleProvisionalRevisions(tenantId: string): Promise<void> {
  const store = getStore();
  try {
    await store.finalizeCommittedProvisional(tenantId);
    await store.prune(tenantId, MAX_CONFIG_REVISIONS);
  } catch {
    /* best-effort; retried on the next begin/list call */
  }
  await store.discardStaleProvisional(tenantId, new Date()).catch(() => undefined);
}

function createMongoRevisionStore(): t.RevisionStore {
  return {
    async insert(revision) {
      const { revisions } = await connectMongoHandle();
      await revisions.insertOne(revision);
    },
    async list(tenantId, limit) {
      const { revisions } = await connectMongoHandle();
      return revisions
        .find(
          { ...baseRevisionFilter(tenantId), status: { $ne: 'provisional' } },
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
    async get(tenantId, id) {
      const { revisions } = await connectMongoHandle();
      return revisions.findOne({ id, ...baseRevisionFilter(tenantId) });
    },
    async prune(tenantId, keep) {
      const { revisions } = await connectMongoHandle();
      const stale = await revisions
        .find({ ...baseRevisionFilter(tenantId), status: { $ne: 'provisional' } }, {
          projection: { id: 1 },
          sort: { createdAt: -1 },
          skip: keep,
        })
        .toArray();
      if (stale.length === 0) return;
      await revisions.deleteMany({
        ...baseRevisionFilter(tenantId),
        id: { $in: stale.map((doc) => doc.id) },
      });
    },
    async finalize(tenantId, id) {
      const { revisions } = await connectMongoHandle();
      await revisions.updateOne({ id, ...tenantFilter(tenantId) }, { $set: { status: 'final' } });
    },
    async discard(tenantId, id) {
      const { revisions } = await connectMongoHandle();
      await revisions.deleteOne({ id, ...tenantFilter(tenantId), status: 'provisional' });
    },
    async markCommitted(tenantId, id) {
      const { revisions } = await connectMongoHandle();
      await revisions.updateOne(
        { id, ...tenantFilter(tenantId) },
        { $set: { committed: true }, $unset: { expiresAt: '' } },
      );
    },
    async finalizeCommittedProvisional(tenantId) {
      const { revisions } = await connectMongoHandle();
      await revisions.updateMany(
        { ...tenantFilter(tenantId), status: 'provisional', committed: true },
        { $set: { status: 'final' } },
      );
    },
    async discardStaleProvisional(tenantId, before) {
      const { revisions } = await connectMongoHandle();
      await revisions.deleteMany({
        ...tenantFilter(tenantId),
        status: 'provisional',
        committed: false,
        expiresAt: { $lt: before },
      });
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

const readRawBaseConfigFromMongo = createServerOnlyFn(
  async (tenantId: string): Promise<t.RawBaseConfigSnapshot> => {
    const { configs } = await connectMongoHandle();
    const doc = await configs.findOne({
      principalType: PrincipalType.ROLE,
      principalId: BASE_CONFIG_PRINCIPAL_ID,
      ...tenantFilter(tenantId),
    });
    if (!doc) {
      return { overrides: {}, absent: true, configVersion: null };
    }
    const overrides = doc.overrides;
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
      return { overrides: {}, absent: false, configVersion: doc.configVersion ?? null };
    }
    return { overrides, absent: false, configVersion: doc.configVersion ?? null };
  },
);

async function fetchRawBaseConfig(tenantId: string): Promise<t.RawBaseConfigSnapshot> {
  if (rawReaderOverride) return rawReaderOverride();
  return readRawBaseConfigFromMongo(tenantId);
}

async function buildConfigRevision(
  cause: t.ConfigRevisionCause,
  status: t.ConfigRevisionStatus,
): Promise<t.ConfigRevision> {
  const tenantId = await authenticatedTenantId();
  await reconcileStaleProvisionalRevisions(tenantId);
  const [raw, actor] = await Promise.all([fetchRawBaseConfig(tenantId), currentActor()]);
  const createdAt = new Date();
  return {
    id: crypto.randomUUID(),
    createdAt: createdAt.toISOString(),
    cause,
    actorId: actor.actorId,
    actorEmail: actor.actorEmail,
    tenantId,
    overrides: raw.overrides,
    absent: raw.absent,
    configVersion: raw.configVersion ?? null,
    status,
    committed: status === 'provisional' ? false : true,
    /** Stored as a real `Date` — Mongo TTL indexes ignore ISO strings. */
    expiresAt:
      status === 'provisional'
        ? new Date(createdAt.getTime() + PROVISIONAL_REVISION_TTL_MS)
        : undefined,
  };
}

export async function beginConfigRevision(cause: t.ConfigRevisionCause): Promise<t.ConfigRevision> {
  const revision = await buildConfigRevision(cause, 'provisional');
  await getStore().insert(revision);
  return revision;
}

export async function finalizeConfigRevision(revision: t.ConfigRevision): Promise<void> {
  const store = getStore();
  await retryWithBackoff(() => store.finalize(revision.tenantId, revision.id));
  try {
    await store.prune(revision.tenantId, MAX_CONFIG_REVISIONS);
  } catch {
    /* retention trim is best-effort once the revision is final */
  }
}

/**
 * Called once the backend mutation has already succeeded — the revision must never
 * be discarded past this point. `markCommitted` is a durable, independent signal
 * (retried on its own) so that even if `finalize` keeps failing, the next
 * `beginConfigRevision`/`listConfigRevisionsFn` call reconciles this revision to
 * `final` instead of letting its TTL discard it as an abandoned attempt.
 */
export async function commitRevisionAfterMutationSuccess(
  revision: t.ConfigRevision,
): Promise<void> {
  const store = getStore();
  await retryWithBackoff(() => store.markCommitted(revision.tenantId, revision.id)).catch(
    () => undefined,
  );
  await finalizeConfigRevision(revision).catch(() => undefined);
}

export async function discardConfigRevision(revision: t.ConfigRevision): Promise<void> {
  await getStore().discard(revision.tenantId, revision.id);
}

export async function readCurrentBaseConfigSnapshot(
  tenantId: string,
): Promise<t.RawBaseConfigSnapshot> {
  return fetchRawBaseConfig(tenantId);
}

export async function readAuthenticatedBaseConfigSnapshot(): Promise<
  t.RawBaseConfigSnapshot & { tenantId: string }
> {
  const tenantId = await authenticatedTenantId();
  const raw = await fetchRawBaseConfig(tenantId);
  return { ...raw, tenantId };
}

export async function snapshotCurrentBaseConfig(
  cause: t.ConfigRevisionCause,
): Promise<t.ConfigRevision> {
  const revision = await beginConfigRevision(cause);
  await finalizeConfigRevision(revision);
  return revision;
}

export const listConfigRevisionsFn = createServerFn({ method: 'GET' }).handler(async () => {
  await requireCapability(SystemCapabilities.MANAGE_CONFIGS);
  const tenantId = await authenticatedTenantId();
  await reconcileStaleProvisionalRevisions(tenantId);
  const revisions = await getStore().list(tenantId, MAX_CONFIG_REVISIONS);
  return { revisions };
});

export const configRevisionsOptions = (userId: string, tenantId?: string) =>
  queryOptions({
    queryKey: ['configRevisions', tenantId ?? '', userId],
    queryFn: () => listConfigRevisionsFn(),
    staleTime: 10_000,
  });

export const restoreConfigRevisionFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireCapability(SystemCapabilities.MANAGE_CONFIGS);
    const tenantId = await authenticatedTenantId();
    const revision = await getStore().get(tenantId, data.id);
    if (!revision || !isFinalizedRevision(revision)) {
      throw new Error('Revision not found');
    }

    const snapshot = await readAuthenticatedBaseConfigSnapshot();
    const response = await apiFetch(`/api/admin/config/role/${BASE_CONFIG_PRINCIPAL_ID}/atomic`, {
      method: 'POST',
      body: JSON.stringify({
        expectedVersion: snapshot.absent ? null : (snapshot.configVersion ?? 0),
        cause: 'restore',
        restoreRevisionId: revision.id,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 409) {
      throw new Error('The configuration was changed by another admin. Reload and try again.');
    }
    if (!response.ok) {
      throw new Error(
        (payload as { error?: string }).error ?? `Failed to restore config: ${response.status}`,
      );
    }
    return { success: true };
  });
