import type { ConfigValue } from './config';

export type ConfigRevisionCause = 'save' | 'import' | 'reset' | 'restore';

export type ConfigRevisionStatus = 'provisional' | 'final';

export interface ConfigRevision {
  id: string;
  createdAt: string;
  cause: ConfigRevisionCause;
  actorId: string;
  actorEmail?: string;
  tenantId: string;
  principalType?: string;
  principalId?: string;
  /** Raw Mongo `configs.overrides` for role/__base__, not the redacted admin GET. */
  overrides: Record<string, ConfigValue>;
  tombstones?: string[];
  priority?: number | null;
  isActive?: boolean | null;
  /** True when no base config document existed at snapshot time. */
  absent: boolean;
  /** Mongo `configs.configVersion` at snapshot time; null when the document was absent. */
  configVersion?: number | null;
  /** Provisional snapshots are hidden from history until the mutation succeeds. */
  status?: ConfigRevisionStatus;
  /** True once the guarded mutation is known to have succeeded — a committed
   *  provisional revision is a real rollback point and must never be discarded
   *  by TTL reconciliation, only retried toward `final`. */
  committed?: boolean;
  /** Stored as a BSON `Date` — Mongo TTL indexes only expire `Date` values, not strings. */
  expiresAt?: Date;
}

export interface ConfigRevisionListItem {
  id: string;
  createdAt: string;
  cause: ConfigRevisionCause;
  actorId: string;
  actorEmail?: string;
}

export interface RevisionStore {
  insert: (revision: ConfigRevision) => Promise<void>;
  list: (tenantId: string, limit: number) => Promise<ConfigRevisionListItem[]>;
  get: (tenantId: string, id: string) => Promise<ConfigRevision | null>;
  prune: (tenantId: string, keep: number) => Promise<void>;
  finalize: (tenantId: string, id: string) => Promise<void>;
  discard: (tenantId: string, id: string) => Promise<void>;
  /** Durable signal that the guarded mutation succeeded, independent of `finalize`. */
  markCommitted: (tenantId: string, id: string) => Promise<void>;
  /** Reconciles any committed-but-still-provisional revisions to `final`. */
  finalizeCommittedProvisional: (tenantId: string) => Promise<void>;
  /** Discards provisional revisions that never received a `committed` signal and
   *  are past their `expiresAt` — i.e. abandoned attempts, not lost rollback points. */
  discardStaleProvisional: (tenantId: string, before: Date) => Promise<void>;
}

export interface RawBaseConfigSnapshot {
  overrides: Record<string, ConfigValue>;
  absent: boolean;
  configVersion?: number | null;
}
