import type { AdminAuditLogEntry, AuditAction } from '@librechat/data-schemas';

/** The capability a grant entry concerns now lives in `metadata.capability`
 * (other event categories omit it). Returns '' when absent or non-string. */
export function auditCapability(entry: Pick<AdminAuditLogEntry, 'metadata'>): string {
  const cap = entry.metadata?.capability;
  return typeof cap === 'string' ? cap : '';
}

export const ACTION_BADGE_STATE: Record<AuditAction, 'success' | 'danger'> = {
  'grant.assigned': 'success',
  'grant.removed': 'danger',
};

export const ACTION_LABEL_KEY: Record<AuditAction, string> = {
  'grant.assigned': 'com_audit_action_assigned',
  'grant.removed': 'com_audit_action_removed',
};

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
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
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
export function localDayBoundaryIso(iso: string, boundary: 'start' | 'end'): string | undefined {
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

/** Build a deep-link to a single audit-log entry, preserving any configured
 * `VITE_BASE_PATH` so the link resolves under subpath deployments (e.g.
 * `/adminpanel`). `basePath` is normalized to drop a trailing slash. */
export function buildEntryPermalink(id: string, origin: string, basePath: string): string {
  const base = basePath.replace(/\/$/, '');
  return `${origin}${base}/grants?tab=audit-log&entryId=${encodeURIComponent(id)}`;
}
