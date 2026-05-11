import { describe, it, expect } from 'vitest';
import { PrincipalType } from 'librechat-data-provider';
import type { AdminAuditLogEntry } from '@librechat/data-schemas';
import {
  ACTION_BADGE_STATE,
  ACTION_FILTER_LABELS,
  AUDIT_ACTION_FILTERS,
  auditLogToCsv,
  capabilityLabel,
  diffGrantState,
  formatTimestamp,
  parseAuditSearch,
} from './auditLogUtils';

const UTF8_BOM = '﻿';

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

const identityLocalize = (k: string) => k;

const expectedHeader =
  'com_audit_csv_col_timestamp,com_audit_csv_col_action,com_audit_csv_col_actor,com_audit_csv_col_actor_id,com_audit_csv_col_target_type,com_audit_csv_col_target_id,com_audit_csv_col_target_name,com_audit_csv_col_capability';

describe('ACTION_FILTER_LABELS', () => {
  it('maps every filter value to a locale key', () => {
    expect(ACTION_FILTER_LABELS.all).toBe('com_audit_filter_all');
    expect(ACTION_FILTER_LABELS.grant_assigned).toBe('com_audit_filter_assigned');
    expect(ACTION_FILTER_LABELS.grant_removed).toBe('com_audit_filter_removed');
  });
});

describe('AUDIT_ACTION_FILTERS', () => {
  it('exposes the ordered filter list', () => {
    expect(AUDIT_ACTION_FILTERS).toEqual(['all', 'grant_assigned', 'grant_removed']);
  });
});

describe('ACTION_BADGE_STATE', () => {
  it('maps each audit action to a badge state', () => {
    expect(ACTION_BADGE_STATE.grant_assigned).toBe('success');
    expect(ACTION_BADGE_STATE.grant_removed).toBe('danger');
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

  it('accepts a locale override', () => {
    const out = formatTimestamp('2026-05-10T14:30:00.000Z', 'en-US');
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('capabilityLabel', () => {
  it('returns the localized label when the locale key resolves', () => {
    const localize = (key: string) => (key === 'com_cap_manage_configs' ? 'Manage configs' : key);
    expect(capabilityLabel('manage:configs', localize)).toBe('Manage configs');
  });

  it('returns the raw capability when no locale match is found', () => {
    expect(capabilityLabel('custom:unknown', identityLocalize)).toBe('custom:unknown');
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
    const csv = auditLogToCsv([sampleEntry], identityLocalize);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    const body = csv.slice(UTF8_BOM.length);
    expect(body.endsWith('\r\n')).toBe(true);
    const lines = body.replace(/\r\n$/, '').split('\r\n');
    expect(lines.length).toBe(2);
    expect(lines[0]).toBe(expectedHeader);
    expect(lines[1]).toContain('Alice Admin');
    expect(lines[1]).toContain('manage:configs');
    expect(lines[1]).toContain('grant_assigned');
  });

  it('returns only the header for an empty entry list', () => {
    expect(auditLogToCsv([], identityLocalize)).toBe(UTF8_BOM + expectedHeader + '\r\n');
  });

  it('quotes and escapes cells containing commas, quotes, or newlines', () => {
    const tricky: AdminAuditLogEntry = {
      ...sampleEntry,
      actorName: 'Alice, "the admin"',
      targetName: 'Line1\nLine2',
    };
    const csv = auditLogToCsv([tricky], identityLocalize);
    expect(csv).toContain('"Alice, ""the admin"""');
    expect(csv).toContain('"Line1\nLine2"');
  });

  it('starts with a UTF-8 BOM', () => {
    const csv = auditLogToCsv([sampleEntry], identityLocalize);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('uses CRLF line endings with a trailing CRLF', () => {
    const csv = auditLogToCsv([sampleEntry, sampleEntry], identityLocalize);
    const body = csv.slice(UTF8_BOM.length);
    expect(body.endsWith('\r\n')).toBe(true);
    const lines = body.slice(0, -2).split('\r\n');
    expect(lines.length).toBe(3);
  });

  it('preserves non-ASCII content through a CSV round trip', () => {
    const entry: AdminAuditLogEntry = {
      ...sampleEntry,
      actorName: 'Müller',
      targetName: '日本語',
    };
    const csv = auditLogToCsv([entry], identityLocalize);
    expect(csv).toContain('Müller');
    expect(csv).toContain('日本語');
  });

  describe('CSV formula-injection defanging', () => {
    const prefixes: Array<{ name: string; char: string }> = [
      { name: 'equals', char: '=' },
      { name: 'plus', char: '+' },
      { name: 'minus', char: '-' },
      { name: 'at', char: '@' },
      { name: 'tab', char: '\t' },
      { name: 'carriage-return', char: '\r' },
    ];

    for (const { name, char } of prefixes) {
      it(`prepends a single quote to actorName starting with ${name}`, () => {
        const payload = `${char}HYPERLINK("evil")`;
        const malicious: AdminAuditLogEntry = {
          ...sampleEntry,
          actorName: payload,
        };
        const csv = auditLogToCsv([malicious], identityLocalize);
        const guarded = `'${payload}`;
        const expectedCell = /[",\n\r]/.test(guarded)
          ? `"${guarded.replace(/"/g, '""')}"`
          : guarded;
        expect(csv).toContain(expectedCell);
        expect(csv).not.toContain(`,${payload},`);
      });
    }
  });
});

describe('parseAuditSearch', () => {
  it('returns an empty result for empty input', () => {
    expect(parseAuditSearch('')).toEqual({ freeText: '', qualifiers: {} });
  });

  it('places plain text into freeText', () => {
    const result = parseAuditSearch('hello world');
    expect(result.qualifiers).toEqual({});
    expect(result.freeText).toBe('hello world');
  });

  it('extracts a single actor qualifier', () => {
    const result = parseAuditSearch('actor:alice');
    expect(result.qualifiers.actor).toBe('alice');
    expect(result.freeText).toBe('');
  });

  it('extracts multiple qualifiers', () => {
    const result = parseAuditSearch('actor:alice capability:manage:configs');
    expect(result.qualifiers.actor).toBe('alice');
    expect(result.qualifiers.capability).toBe('manage:configs');
  });

  it('supports a target qualifier', () => {
    const result = parseAuditSearch('target:bob');
    expect(result.qualifiers.target).toBe('bob');
  });

  it('handles quoted multi-word qualifier values', () => {
    const result = parseAuditSearch('actor:"Alice Admin"');
    expect(result.qualifiers.actor).toBe('Alice Admin');
    expect(result.freeText).toBe('');
  });

  it('maps created:> to createdAfter', () => {
    const result = parseAuditSearch('created:>2026-05-01');
    expect(result.qualifiers.createdAfter).toBe('2026-05-01');
    expect(result.qualifiers.createdBefore).toBeUndefined();
  });

  it('maps created:>= to createdAfter', () => {
    const result = parseAuditSearch('created:>=2026-05-01');
    expect(result.qualifiers.createdAfter).toBe('2026-05-01');
  });

  it('maps created:< to createdBefore', () => {
    const result = parseAuditSearch('created:<2026-05-31');
    expect(result.qualifiers.createdBefore).toBe('2026-05-31');
    expect(result.qualifiers.createdAfter).toBeUndefined();
  });

  it('maps created:<= to createdBefore', () => {
    const result = parseAuditSearch('created:<=2026-05-31');
    expect(result.qualifiers.createdBefore).toBe('2026-05-31');
  });

  it('treats created without an operator as an exact day window', () => {
    const result = parseAuditSearch('created:2026-05-01');
    expect(result.qualifiers.createdAfter).toBe('2026-05-01');
    expect(result.qualifiers.createdBefore).toBe('2026-05-01');
  });

  it('keeps free text alongside qualifiers', () => {
    const result = parseAuditSearch('login actor:alice from prod');
    expect(result.qualifiers.actor).toBe('alice');
    expect(result.freeText).toBe('login from prod');
  });

  it('accepts qualifier keys case-insensitively', () => {
    expect(parseAuditSearch('Actor:alice').qualifiers.actor).toBe('alice');
    expect(parseAuditSearch('ACTOR:alice').qualifiers.actor).toBe('alice');
  });

  it('treats unknown qualifier keys as free text', () => {
    const result = parseAuditSearch('foo:bar actor:alice');
    expect(result.qualifiers.actor).toBe('alice');
    expect(result.freeText).toBe('foo:bar');
  });

  it('combines actor + created range + free text', () => {
    const result = parseAuditSearch(
      'actor:alice created:>2026-05-01 created:<2026-05-31 audit',
    );
    expect(result.qualifiers).toEqual({
      actor: 'alice',
      createdAfter: '2026-05-01',
      createdBefore: '2026-05-31',
    });
    expect(result.freeText).toBe('audit');
  });
});

describe('diffGrantState', () => {
  it('returns an empty diff when both sides are undefined', () => {
    expect(diffGrantState(undefined, undefined)).toEqual({
      added: [],
      removed: [],
      unchanged: [],
    });
  });

  it('returns an empty diff when both sides are empty arrays', () => {
    expect(diffGrantState([], [])).toEqual({ added: [], removed: [], unchanged: [] });
  });

  it('treats every capability as added when before is missing', () => {
    const diff = diffGrantState(undefined, ['a', 'b']);
    expect(new Set(diff.added)).toEqual(new Set(['a', 'b']));
    expect(diff.removed).toEqual([]);
    expect(diff.unchanged).toEqual([]);
  });

  it('treats every capability as removed when after is missing', () => {
    const diff = diffGrantState(['a', 'b'], undefined);
    expect(new Set(diff.removed)).toEqual(new Set(['a', 'b']));
    expect(diff.added).toEqual([]);
    expect(diff.unchanged).toEqual([]);
  });

  it('classifies added, removed, and unchanged capabilities', () => {
    const diff = diffGrantState(['a', 'b', 'c'], ['b', 'c', 'd']);
    expect(new Set(diff.added)).toEqual(new Set(['d']));
    expect(new Set(diff.removed)).toEqual(new Set(['a']));
    expect(new Set(diff.unchanged)).toEqual(new Set(['b', 'c']));
  });

  it('returns identical input as fully unchanged', () => {
    const diff = diffGrantState(['a', 'b'], ['a', 'b']);
    expect(new Set(diff.unchanged)).toEqual(new Set(['a', 'b']));
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  it('deduplicates repeated capabilities via Set semantics', () => {
    const diff = diffGrantState(['a', 'a', 'b'], ['a', 'a', 'c']);
    expect(diff.unchanged).toEqual(['a']);
    expect(diff.added).toEqual(['c']);
    expect(diff.removed).toEqual(['b']);
  });
});
