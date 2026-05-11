import { describe, it, expect } from 'vitest';
import { PrincipalType } from 'librechat-data-provider';
import type { AdminAuditLogEntry } from '@librechat/data-schemas';
import { ACTION_FILTER_LABELS, auditLogToCsv, capabilityLabel, formatTimestamp } from './auditLogUtils';

const sampleEntry: AdminAuditLogEntry = {
  id: 'a1',
  action: 'grant_assigned',
  actorId: 'u-1',
  actorName: 'Alice Admin',
  targetPrincipalType: PrincipalType.USER,
  targetPrincipalId: 'u-2',
  targetName: 'Bob User',
  capability: 'manage:configs',
  timestamp: '2026-05-10T14:30:00.000Z',
};

describe('ACTION_FILTER_LABELS', () => {
  it('maps every filter value to a locale key', () => {
    expect(ACTION_FILTER_LABELS.all).toBe('com_audit_filter_all');
    expect(ACTION_FILTER_LABELS.grant_assigned).toBe('com_audit_filter_assigned');
    expect(ACTION_FILTER_LABELS.grant_removed).toBe('com_audit_filter_removed');
  });
});

describe('formatTimestamp', () => {
  it('produces a non-empty localized string for valid ISO input', () => {
    const out = formatTimestamp('2026-05-10T14:30:00.000Z');
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toBe('2026-05-10T14:30:00.000Z');
  });

  it('falls back to the input string when the date is invalid', () => {
    expect(formatTimestamp('not-a-date')).toBe('not-a-date');
  });
});

describe('capabilityLabel', () => {
  it('returns the localized label when the locale key resolves', () => {
    const localize = (key: string) => (key === 'com_cap_manage_configs' ? 'Manage configs' : key);
    expect(capabilityLabel('manage:configs', localize)).toBe('Manage configs');
  });

  it('returns the raw capability when no locale match is found', () => {
    const localize = (key: string) => key;
    expect(capabilityLabel('custom:unknown', localize)).toBe('custom:unknown');
  });

  it('converts all colons in the capability to underscores in the lookup key', () => {
    let observed = '';
    const localize = (key: string) => {
      observed = key;
      return key;
    };
    capabilityLabel('manage:configs:mcp', localize);
    expect(observed).toBe('com_cap_manage_configs_mcp');
  });
});

describe('auditLogToCsv', () => {
  it('emits a header row and one row per entry', () => {
    const csv = auditLogToCsv([sampleEntry]);
    const lines = csv.split('\n');
    expect(lines.length).toBe(2);
    expect(lines[0]).toBe(
      'timestamp,action,actorId,actorName,targetPrincipalType,targetPrincipalId,targetName,capability',
    );
    expect(lines[1]).toContain('Alice Admin');
    expect(lines[1]).toContain('manage:configs');
    expect(lines[1]).toContain('grant_assigned');
  });

  it('returns only the header for an empty entry list', () => {
    expect(auditLogToCsv([])).toBe(
      'timestamp,action,actorId,actorName,targetPrincipalType,targetPrincipalId,targetName,capability',
    );
  });

  it('quotes and escapes cells containing commas, quotes, or newlines', () => {
    const tricky: AdminAuditLogEntry = {
      ...sampleEntry,
      actorName: 'Alice, "the admin"',
      targetName: 'Line1\nLine2',
    };
    const csv = auditLogToCsv([tricky]);
    expect(csv).toContain('"Alice, ""the admin"""');
    expect(csv).toContain('"Line1\nLine2"');
  });
});
