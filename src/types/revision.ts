import type { ConfigValue } from './config';

export type ConfigRevisionCause = 'save' | 'import' | 'reset' | 'restore';

export interface ConfigRevision {
  id: string;
  createdAt: string;
  cause: ConfigRevisionCause;
  actorId: string;
  actorEmail?: string;
  overrides: Record<string, ConfigValue>;
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
  list: (limit: number) => Promise<ConfigRevisionListItem[]>;
  get: (id: string) => Promise<ConfigRevision | null>;
  prune: (keep: number) => Promise<void>;
}
