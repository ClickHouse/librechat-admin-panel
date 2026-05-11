import type { AdminAuditLogEntry } from '@librechat/data-schemas';
import type * as t from '@/types';

export const ACTION_FILTER_LABELS: Record<t.ActionFilter, string> = {
  all: 'com_audit_filter_all',
  grant_assigned: 'com_audit_filter_assigned',
  grant_removed: 'com_audit_filter_removed',
};

const CSV_COLUMNS: readonly (keyof AdminAuditLogEntry)[] = [
  'timestamp',
  'action',
  'actorId',
  'actorName',
  'targetPrincipalType',
  'targetPrincipalId',
  'targetName',
  'capability',
];

export function formatTimestamp(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
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
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function auditLogToCsv(entries: readonly AdminAuditLogEntry[]): string {
  const header = CSV_COLUMNS.join(',');
  const rows = entries.map((entry) =>
    CSV_COLUMNS.map((col) => escapeCsvCell(String(entry[col] ?? ''))).join(','),
  );
  return [header, ...rows].join('\n');
}
