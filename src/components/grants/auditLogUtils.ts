import type { AdminAuditLogEntry, AuditAction } from '@librechat/data-schemas';
import type * as t from '@/types';

export const ACTION_FILTER_LABELS: Record<t.ActionFilter, string> = {
  all: 'com_audit_filter_all',
  grant_assigned: 'com_audit_filter_assigned',
  grant_removed: 'com_audit_filter_removed',
};

export const AUDIT_ACTION_FILTERS: readonly t.ActionFilter[] = [
  'all',
  'grant_assigned',
  'grant_removed',
] as const;

export const ACTION_BADGE_STATE: Record<AuditAction, 'success' | 'danger'> = {
  grant_assigned: 'success',
  grant_removed: 'danger',
};

export const ACTION_LABEL_KEY: Record<AuditAction, string> = {
  grant_assigned: 'com_audit_action_assigned',
  grant_removed: 'com_audit_action_removed',
};

const CSV_COLUMNS = [
  { key: 'timestamp', labelKey: 'com_audit_csv_col_timestamp' },
  { key: 'action', labelKey: 'com_audit_csv_col_action' },
  { key: 'actorName', labelKey: 'com_audit_csv_col_actor' },
  { key: 'actorId', labelKey: 'com_audit_csv_col_actor_id' },
  { key: 'targetPrincipalType', labelKey: 'com_audit_csv_col_target_type' },
  { key: 'targetPrincipalId', labelKey: 'com_audit_csv_col_target_id' },
  { key: 'targetName', labelKey: 'com_audit_csv_col_target_name' },
  { key: 'capability', labelKey: 'com_audit_csv_col_capability' },
] as const satisfies readonly { key: keyof AdminAuditLogEntry; labelKey: string }[];

type _CsvColumnsExhaustive = Exclude<
  keyof AdminAuditLogEntry,
  'id' | (typeof CSV_COLUMNS)[number]['key']
> extends never
  ? true
  : never;
const _csvColumnsExhaustive: _CsvColumnsExhaustive = true;
void _csvColumnsExhaustive;

const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const UTF8_BOM = '﻿';

export function formatTimestamp(iso: string, locale: string | undefined = undefined): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function capabilityLabel(cap: string, localize: (key: string) => string): string {
  const key = `com_cap_${cap.replace(/:/g, '_')}`;
  const label = localize(key);
  return label !== key ? label : cap;
}

function escapeCsvCell(value: string): string {
  if (value === '') return '';
  const guarded = FORMULA_PREFIX.test(value) ? `'${value}` : value;
  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

export function auditLogToCsv(
  entries: readonly AdminAuditLogEntry[],
  localize: (key: string) => string,
): string {
  const header = CSV_COLUMNS.map((col) => escapeCsvCell(localize(col.labelKey))).join(',');
  const rows = entries.map((entry) =>
    CSV_COLUMNS.map((col) => escapeCsvCell(String(entry[col.key] ?? ''))).join(','),
  );
  return UTF8_BOM + [header, ...rows].join('\r\n') + '\r\n';
}

const QUALIFIER_KEYS = new Set(['actor', 'target', 'capability', 'created']);
const TOKEN_RE = /(\w+):(>?<?=?)?(?:"([^"]*)"|(\S+))|"([^"]*)"|(\S+)/g;

function assignQualifier(
  qualifiers: t.AuditSearchQualifiers,
  key: string,
  op: string | undefined,
  value: string,
): void {
  if (key === 'created') {
    if (op === '>' || op === '>=') {
      qualifiers.createdAfter = value;
      return;
    }
    if (op === '<' || op === '<=') {
      qualifiers.createdBefore = value;
      return;
    }
    qualifiers.createdAfter = value;
    qualifiers.createdBefore = value;
    return;
  }
  if (key === 'actor') {
    qualifiers.actor = value;
    return;
  }
  if (key === 'target') {
    qualifiers.target = value;
    return;
  }
  if (key === 'capability') {
    qualifiers.capability = value;
  }
}

export function parseAuditSearch(input: string): t.ParsedAuditSearch {
  const qualifiers: t.AuditSearchQualifiers = {};
  const freeTextParts: string[] = [];
  if (!input) {
    return { freeText: '', qualifiers };
  }

  for (const match of input.matchAll(TOKEN_RE)) {
    const [raw, key, op, quotedValue, bareValue, quotedFree, bareFree] = match;
    const normalizedKey = key?.toLowerCase();
    if (normalizedKey && QUALIFIER_KEYS.has(normalizedKey)) {
      const value = quotedValue ?? bareValue ?? '';
      if (!value) {
        continue;
      }
      assignQualifier(qualifiers, normalizedKey, op, value);
      continue;
    }
    if (key) {
      freeTextParts.push(raw);
      continue;
    }
    const free = quotedFree ?? bareFree ?? '';
    if (free) {
      freeTextParts.push(free);
    }
  }

  return { freeText: freeTextParts.join(' '), qualifiers };
}

export function diffGrantState(
  before: readonly string[] | undefined,
  after: readonly string[] | undefined,
): t.GrantDiff {
  const beforeSet = new Set(before ?? []);
  const afterSet = new Set(after ?? []);
  const added: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];
  for (const cap of afterSet) {
    if (beforeSet.has(cap)) {
      unchanged.push(cap);
    } else {
      added.push(cap);
    }
  }
  for (const cap of beforeSet) {
    if (!afterSet.has(cap)) {
      removed.push(cap);
    }
  }
  return { added, removed, unchanged };
}
