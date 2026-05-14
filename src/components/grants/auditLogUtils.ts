import type { AdminAuditLogEntry, AuditAction } from '@librechat/data-schemas';

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

type _CsvColumnsExhaustive =
  Exclude<keyof AdminAuditLogEntry, 'id' | (typeof CSV_COLUMNS)[number]['key']> extends never
    ? true
    : never;
const _csvColumnsExhaustive: _CsvColumnsExhaustive = true;
void _csvColumnsExhaustive;

// Strip leading characters spreadsheets render as visual whitespace but that
// are NOT themselves formula triggers (space, NBSP  , BOM ﻿). This
// is the "decoy" sneak path — a payload like " =SUM(...)" would otherwise pass
// the raw-prefix check yet still execute when Excel renders it.
const NON_TRIGGER_LEADING = /^[  ﻿]+/;
// Cover spreadsheet-formula triggers (`=` `+` `-` `@`) and Excel-only command
// vectors (`\t` `\r` `\n` `|`). The vertical bar is part of DDE invocation
// (e.g. `|cmd|`), and `\n` matches what spreadsheets accept as a new line.
const FORMULA_PREFIX = /^[=+\-@\t\r\n|]/;
const UTF8_BOM = '﻿';

/** Parse a `YYYY-MM-DD` filter value as a local-time date so the DatePicker
 * round-trips the same calendar day the user picked, regardless of TZ.
 * Rejects rolled-over inputs like `2026-13-01` (which `Date` would silently
 * coerce to January 2027) by re-checking the parsed components. */
export function isoDateToDate(iso: string): Date | undefined {
  if (!iso) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return undefined;
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return undefined;
  }
  return date;
}

export function dateToIsoDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Convert a `YYYY-MM-DD` filter value into the ISO timestamp for the start
 * (inclusive) or end (inclusive, millisecond-precise) of that local-time day.
 * Mixing local-day pick-list values with UTC midnight (the prior behaviour)
 * caused off-by-one filtering for any non-UTC user. */
export function localDayBoundaryIso(
  iso: string,
  boundary: 'start' | 'end',
): string | undefined {
  const date = isoDateToDate(iso);
  if (!date) return undefined;
  if (boundary === 'end') date.setHours(23, 59, 59, 999);
  return date.toISOString();
}

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

/** Treat a cell as a formula-injection vector if its first character is a
 * formula trigger, or if removing leading non-trigger whitespace (space, NBSP,
 * BOM) reveals one. Trimming the entire `\s` class would mistakenly accept
 * payloads that lead with `\r` / `\n` / `\t`, which are themselves triggers. */
function hasFormulaPrefix(value: string): boolean {
  if (FORMULA_PREFIX.test(value)) return true;
  return FORMULA_PREFIX.test(value.replace(NON_TRIGGER_LEADING, ''));
}

function escapeCsvCell(value: string): string {
  if (value === '') return '';
  const guarded = hasFormulaPrefix(value) ? `'${value}` : value;
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
