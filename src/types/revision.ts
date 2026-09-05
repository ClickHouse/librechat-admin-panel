import type { ConfigValue } from './config';

export type ConfigRevisionCause = 'save' | 'import' | 'reset' | 'restore';

export interface ConfigRevisionListItem {
  id: string;
  createdAt: string;
  cause: ConfigRevisionCause;
  actorId: string;
  actorEmail?: string;
}

export interface RawBaseConfigSnapshot {
  overrides: Record<string, ConfigValue>;
  absent: boolean;
  configVersion?: number | null;
}
