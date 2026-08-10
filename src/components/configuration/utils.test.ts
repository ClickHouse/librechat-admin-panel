import { describe, it, expect } from 'vitest';
import type * as t from '@/types';
import {
  getControlType,
  getEnumOptions,
  getArrayItemType,
  splitUnionTypes,
  partitionScopeResetPaths,
  mergeIndexedArrayEdits,
  buildSavePayload,
  applyConfigEdit,
  kvPairsEditValue,
  serializeModalValue,
} from './utils';
import { createField } from '@/test/fixtures';
import { flattenObject } from '@/utils';

describe('getControlType', () => {
  it('maps boolean to toggle', () => {
    expect(getControlType(createField({ key: 'enabled', type: 'boolean' }))).toBe('toggle');
  });

  it('maps enum(...) to select', () => {
    expect(getControlType(createField({ key: 'mode', type: 'enum(dark | light)' }))).toBe('select');
  });

  it('maps number to number', () => {
    expect(getControlType(createField({ key: 'port', type: 'number' }))).toBe('number');
  });

  it('maps string to text', () => {
    expect(getControlType(createField({ key: 'title', type: 'string' }))).toBe('text');
  });

  it('maps array<string> to array', () => {
    expect(getControlType(createField({ key: 'tags', type: 'array<string>' }))).toBe('array');
  });

  it('maps object to object', () => {
    expect(getControlType(createField({ key: 'settings', type: 'object', isObject: true }))).toBe(
      'object',
    );
  });

  it('prioritizes isObject flag over type string', () => {
    expect(getControlType(createField({ key: 'nested', type: 'ZodObject', isObject: true }))).toBe(
      'object',
    );
  });

  it('maps record to record', () => {
    expect(getControlType(createField({ key: 'headers', type: 'record' }))).toBe('record');
  });

  it('maps union containing string and number to text (string is more general)', () => {
    expect(getControlType(createField({ key: 'limit', type: 'union(number | string)' }))).toBe(
      'text',
    );
  });

  it('maps union containing only number (no string) to number', () => {
    expect(getControlType(createField({ key: 'limit', type: 'union(number | boolean)' }))).toBe(
      'number',
    );
  });

  it('maps union containing string (no number) to text', () => {
    expect(getControlType(createField({ key: 'val', type: 'union(string | boolean)' }))).toBe(
      'text',
    );
  });

  it('maps union containing only boolean to toggle', () => {
    expect(
      getControlType(createField({ key: 'flag', type: 'union(boolean | literal(null))' })),
    ).toBe('toggle');
  });

  it('falls back to record for unknown types', () => {
    expect(getControlType(createField({ key: 'data', type: 'ZodAny' }))).toBe('record');
  });

  it('maps wide union with primitives and complex types to record', () => {
    expect(
      getControlType(
        createField({
          key: 'doc',
          type: 'union(null | boolean | number | string | array<unknown> | record)',
        }),
      ),
    ).toBe('record');
  });

  it('maps union(boolean | object) with children to switch-object', () => {
    expect(
      getControlType(
        createField({
          key: 'prompts',
          type: 'union(boolean | object)',
          children: [createField({ key: 'use', type: 'boolean' })],
        }),
      ),
    ).toBe('switch-object');
  });

  it('maps union(boolean | object) without children to toggle', () => {
    expect(getControlType(createField({ key: 'x', type: 'union(boolean | object)' }))).toBe(
      'toggle',
    );
  });

  it('maps union(string | record) to text-record', () => {
    expect(getControlType(createField({ key: 'label', type: 'union(string | record)' }))).toBe(
      'text-record',
    );
  });

  it('maps union(string | array<string>) to text-record', () => {
    expect(
      getControlType(createField({ key: 'content', type: 'union(string | array<string>)' })),
    ).toBe('text-record');
  });

  it('maps union(array<string> | record) to list-record', () => {
    expect(
      getControlType(createField({ key: 'models', type: 'union(array<string> | record)' })),
    ).toBe('list-record');
  });

  it('maps union(enum(...) | number) to select', () => {
    expect(
      getControlType(
        createField({
          key: 'stderr',
          type: 'union(enum(pipe | ignore | inherit) | number)',
        }),
      ),
    ).toBe('select');
  });
});

describe('getEnumOptions', () => {
  it('parses standard enum options', () => {
    const options = getEnumOptions('enum(dark | light | system)');
    expect(options).toEqual([
      { label: 'Dark', value: 'dark' },
      { label: 'Light', value: 'light' },
      { label: 'System', value: 'system' },
    ]);
  });

  it('filters empty segments from leading/trailing delimiters', () => {
    const options = getEnumOptions('enum(| dark | light |)');
    expect(options).toEqual([
      { label: 'Dark', value: 'dark' },
      { label: 'Light', value: 'light' },
    ]);
  });

  it('handles single-value enum', () => {
    const options = getEnumOptions('enum(only)');
    expect(options).toEqual([{ label: 'Only', value: 'only' }]);
  });

  it('replaces underscores with spaces in labels', () => {
    const options = getEnumOptions('enum(my_custom_value)');
    expect(options).toEqual([{ label: 'My custom value', value: 'my_custom_value' }]);
  });

  it('returns empty array for non-enum type strings', () => {
    expect(getEnumOptions('string')).toEqual([]);
    expect(getEnumOptions('number')).toEqual([]);
  });

  it('extracts enum options from union(enum(...) | number) without leaking other branches', () => {
    const options = getEnumOptions('union(enum(pipe | ignore | inherit) | number)');
    expect(options).toEqual([
      { label: 'Pipe', value: 'pipe' },
      { label: 'Ignore', value: 'ignore' },
      { label: 'Inherit', value: 'inherit' },
    ]);
  });

  it('does not produce options with trailing parens from greedy regex', () => {
    const options = getEnumOptions('union(enum(a | b) | number)');
    for (const opt of options) {
      expect(opt.value).not.toContain(')');
      expect(opt.label).not.toContain(')');
    }
  });
});

describe('getArrayItemType', () => {
  it('extracts inner type from array<T>', () => {
    expect(getArrayItemType('array<string>')).toBe('string');
  });

  it('defaults to string when no angle brackets', () => {
    expect(getArrayItemType('array')).toBe('string');
  });
});

describe('splitUnionTypes', () => {
  it('splits simple union into parts', () => {
    expect(splitUnionTypes('union(string | number)')).toEqual(['string', 'number']);
  });

  it('respects depth tracking and does not split inside nested parens', () => {
    const result = splitUnionTypes('union(enum(a | b) | number)');
    expect(result).toEqual(['enum(a | b)', 'number']);
  });

  it('returns single type for union with one member', () => {
    expect(splitUnionTypes('union(string)')).toEqual(['string']);
  });

  it('returns empty array for non-union input', () => {
    expect(splitUnionTypes('string')).toEqual([]);
    expect(splitUnionTypes('')).toEqual([]);
  });

  it('handles nested parens without splitting inner content', () => {
    const result = splitUnionTypes('union(enum(a | b) | string)');
    expect(result).toEqual(['enum(a | b)', 'string']);
  });
});

describe('getControlType — union(literal(...)) as select', () => {
  it('returns select for union of literals', () => {
    const field = createField({
      key: 'method',
      type: 'union(literal("completion") | literal("structured"))',
    });
    expect(getControlType(field)).toBe('select');
  });
});

describe('getEnumOptions — union(literal(...)) parsing', () => {
  it('extracts options from union of literal types', () => {
    const options = getEnumOptions('union(literal("completion") | literal("structured"))');
    expect(options).toEqual([
      { label: 'Completion', value: 'completion' },
      { label: 'Structured', value: 'structured' },
    ]);
  });

  it('returns empty array for non-enum/non-literal-union input', () => {
    expect(getEnumOptions('string')).toEqual([]);
    expect(getEnumOptions('union(string | number)')).toEqual([]);
  });
});

describe('mergeIndexedArrayEdits', () => {
  it('creates the array under a parent path absent from the baseline', () => {
    /**
     * Regression: the merge previously bailed out and wrote the array at the
     * wrong nesting level when its parent (e.g. modelSpecs) wasn't in
     * librechat.yaml, causing typed list entries to disappear from view.
     */
    const merged = mergeIndexedArrayEdits({}, [
      ['modelSpecs.list.0', { name: 'test', label: 'Test' }],
    ]);
    expect(merged).toEqual({
      modelSpecs: { list: [{ name: 'test', label: 'Test' }] },
    });
  });

  it('preserves baseline siblings when introducing a new section', () => {
    const merged = mergeIndexedArrayEdits({ interface: { parameters: true } }, [
      ['modelSpecs.list.0', { name: 'a' }],
    ]);
    expect(merged).toEqual({
      interface: { parameters: true },
      modelSpecs: { list: [{ name: 'a' }] },
    });
  });

  it('merges into an existing parent without clobbering its keys', () => {
    const merged = mergeIndexedArrayEdits({ modelSpecs: { enforce: true, prioritize: false } }, [
      ['modelSpecs.list.0', { name: 'a' }],
    ]);
    expect(merged.modelSpecs).toEqual({
      enforce: true,
      prioritize: false,
      list: [{ name: 'a' }],
    });
  });

  it('places multiple indexed edits at their correct positions', () => {
    const merged = mergeIndexedArrayEdits({}, [
      ['modelSpecs.list.0', { name: 'a' }],
      ['modelSpecs.list.2', { name: 'c' }],
    ]);
    const list = (merged.modelSpecs as { list: Array<{ name: string } | undefined> }).list;
    expect(list[0]).toEqual({ name: 'a' });
    expect(list[1]).toBeUndefined();
    expect(list[2]).toEqual({ name: 'c' });
  });

  it('returns the baseline unchanged when there are no indexed edits', () => {
    const baseline = { interface: { parameters: true } };
    expect(mergeIndexedArrayEdits(baseline, [])).toEqual(baseline);
  });

  it('does not mutate the baseline object', () => {
    const baseline: Record<string, unknown> = { modelSpecs: { enforce: true } };
    const before = JSON.parse(JSON.stringify(baseline));
    mergeIndexedArrayEdits(baseline as Record<string, never>, [
      ['modelSpecs.list.0', { name: 'a' }],
    ]);
    expect(baseline).toEqual(before);
  });

  it('skips an edit when an intermediate path is a primitive', () => {
    /**
     * Defensive: refuse to overwrite a primitive at an intermediate path
     * because doing so would silently destroy unrelated baseline data.
     */
    const merged = mergeIndexedArrayEdits({ modelSpecs: 'not-an-object' }, [
      ['modelSpecs.list.0', { name: 'a' }],
    ]);
    expect(merged).toEqual({ modelSpecs: 'not-an-object' });
  });

  it('skips an edit when an intermediate path is an array', () => {
    const merged = mergeIndexedArrayEdits({ modelSpecs: [1, 2, 3] }, [
      ['modelSpecs.list.0', { name: 'a' }],
    ]);
    expect(merged).toEqual({ modelSpecs: [1, 2, 3] });
  });

  it('walks deep parent chains, creating each missing level', () => {
    const merged = mergeIndexedArrayEdits({}, [['endpoints.custom.deep.list.0', { name: 'x' }]]);
    expect(merged).toEqual({
      endpoints: { custom: { deep: { list: [{ name: 'x' }] } } },
    });
  });
});

describe('applyConfigEdit', () => {
  it('updates a pending whole-array edit when a newly-added entry is typed into', () => {
    const prev = {
      'modelSpecs.list': [{}, { name: 'smart-assistant' }],
    };
    const result = applyConfigEdit(
      prev,
      'modelSpecs.list.0',
      { name: 'TEST1' },
      {},
      new Set(),
      new Set(),
    );
    expect(result).toEqual({
      'modelSpecs.list': [{ name: 'TEST1' }, { name: 'smart-assistant' }],
    });
    expect(result).not.toHaveProperty('modelSpecs.list.0');
  });

  it('keeps per-index edits when no parent array edit is pending', () => {
    const result = applyConfigEdit(
      {},
      'modelSpecs.list.0',
      { name: 'TEST1' },
      {},
      new Set(),
      new Set(),
    );
    expect(result).toEqual({
      'modelSpecs.list.0': { name: 'TEST1' },
    });
  });

  it('drops stale indexed edits when a whole-array edit is queued', () => {
    const result = applyConfigEdit(
      { 'modelSpecs.list.0': { name: 'old' } },
      'modelSpecs.list',
      [{ name: 'new' }],
      {},
      new Set(),
      new Set(),
    );
    expect(result).toEqual({
      'modelSpecs.list': [{ name: 'new' }],
    });
  });
});

describe('partitionScopeResetPaths', () => {
  it('routes whole MCP entry resets to tombstones', () => {
    expect(
      partitionScopeResetPaths(
        ['mcpServers.github', 'mcpServers.github.url', 'interface.modelSelect'],
        new Set(['github']),
      ),
    ).toEqual({
      resetPaths: ['mcpServers.github.url', 'interface.modelSelect'],
      tombstonePaths: ['mcpServers.github'],
    });
  });

  it('routes whole MCP entry resets to unsets when the entry is scope-local', () => {
    expect(
      partitionScopeResetPaths(
        ['mcpServers.scopeOnly', 'mcpServers.inherited'],
        new Set(['inherited']),
      ),
    ).toEqual({
      resetPaths: ['mcpServers.scopeOnly'],
      tombstonePaths: ['mcpServers.inherited'],
    });
  });

  it('preserves input order within reset and tombstone groups', () => {
    expect(
      partitionScopeResetPaths(
        ['mcpServers.alpha', 'registration.enabled', 'mcpServers.beta', 'endpoints.custom.0'],
        new Set(['alpha', 'beta']),
      ),
    ).toEqual({
      resetPaths: ['registration.enabled', 'endpoints.custom.0'],
      tombstonePaths: ['mcpServers.alpha', 'mcpServers.beta'],
    });
  });
});

describe('buildSavePayload — masked secrets never reach the backend', () => {
  const schemaPaths = new Set([
    'ocr.apiKey',
    'ocr.baseURL',
    'speech.tts.openai.apiKey',
    'speech.tts.openai.model',
  ]);
  const config = {
    ocr: { apiKeyPreview: 'sk-mist...4321', baseURL: 'https://ocr.example' },
  };
  const baseline = flattenObject(config);
  const noIntermediates = new Set<string>();
  const noContainers = new Set<string>();

  it('submitting without touching the masked secret excludes it from the payload', () => {
    const edited = applyConfigEdit(
      {},
      'ocr.baseURL',
      'https://new.example',
      baseline,
      noIntermediates,
      noContainers,
    );
    const { saves, resets } = buildSavePayload(new Set(['ocr.baseURL']), edited, schemaPaths);
    expect(saves).toEqual([{ fieldPath: 'ocr.baseURL', value: 'https://new.example' }]);
    expect(resets).toEqual([]);
    expect(saves.some((s) => s.fieldPath === 'ocr.apiKey')).toBe(false);
    expect(JSON.stringify(saves)).not.toContain('sk-mist...4321');
  });

  it('submitting with no touched paths produces an empty payload', () => {
    const { touched, saves, resets } = buildSavePayload(new Set(), {}, schemaPaths);
    expect(touched).toEqual([]);
    expect(saves).toEqual([]);
    expect(resets).toEqual([]);
  });

  it('a display companion leaf path never survives as a save entry', () => {
    const { saves } = buildSavePayload(
      new Set(['ocr.apiKeyPreview']),
      { 'ocr.apiKeyPreview': 'sk-mist...4321' },
      schemaPaths,
    );
    expect(saves).toEqual([]);
  });

  it('display companions nested in object values are stripped', () => {
    const edited = {
      'speech.tts.openai': { apiKeyPreview: 'sk-abc...1111', model: 'tts-1' },
    };
    const { saves } = buildSavePayload(new Set(['speech.tts.openai']), edited, schemaPaths);
    expect(saves).toEqual([{ fieldPath: 'speech.tts.openai', value: { model: 'tts-1' } }]);
  });

  it('a typed replacement is submitted as the new value', () => {
    const edited = applyConfigEdit(
      {},
      'ocr.apiKey',
      'brand-new-secret',
      baseline,
      noIntermediates,
      noContainers,
    );
    const { saves } = buildSavePayload(new Set(['ocr.apiKey']), edited, schemaPaths);
    expect(saves).toEqual([{ fieldPath: 'ocr.apiKey', value: 'brand-new-secret' }]);
  });

  it('cancelling a replacement drops the edit so nothing is submitted', () => {
    let edited = applyConfigEdit(
      {},
      'ocr.apiKey',
      'half-typed',
      baseline,
      noIntermediates,
      noContainers,
    );
    edited = applyConfigEdit(
      edited,
      'ocr.apiKey',
      undefined,
      baseline,
      noIntermediates,
      noContainers,
    );
    const { touched, saves, resets } = buildSavePayload(
      new Set(['ocr.apiKey']),
      edited,
      schemaPaths,
    );
    expect(touched).toEqual([]);
    expect(saves).toEqual([]);
    expect(resets).toEqual([]);
  });

  it('documents why abandoning a replacement must not go through onChange(path, undefined)', () => {
    // If a scope-resolved baseline ever reads back as '' for a redacted secret's
    // real path (not undefined/absent, as the base config baseline always is),
    // routing Cancel through the generic onChange/applyConfigEdit pipeline would
    // register a real pending reset instead of a no-op. This is exactly why
    // SecretField's Cancel calls a dedicated onDiscardField instead of
    // onChange(path, undefined) — see FieldRenderer.test.tsx's
    // "cancelling the replace flow discards the field directly" case.
    const emptyBaseline: t.FlatConfigMap = { 'ocr.apiKey': '' };
    const edited = applyConfigEdit(
      {},
      'ocr.apiKey',
      undefined,
      emptyBaseline,
      noIntermediates,
      noContainers,
    );
    const { resets } = buildSavePayload(new Set(['ocr.apiKey']), edited, schemaPaths);
    expect(resets).toEqual(['ocr.apiKey']);
  });

  it('resetting a masked secret produces a reset for the real path, not a save', () => {
    const edited: t.FlatConfigMap = { 'ocr.apiKey': undefined };
    const { saves, resets } = buildSavePayload(new Set(['ocr.apiKey']), edited, schemaPaths);
    expect(saves).toEqual([]);
    expect(resets).toEqual(['ocr.apiKey']);
  });
});

describe('kvPairsEditValue', () => {
  it('passes non-empty pairs through unchanged for save-time serialization', () => {
    const pairs: t.KeyValuePair[] = [
      { key: 'Authorization', value: 'Bearer {{API_KEY}}', valueType: 'string' },
    ];
    expect(kvPairsEditValue(pairs)).toBe(pairs);
  });

  it('converts an emptied pair list to an empty record', () => {
    expect(kvPairsEditValue([])).toEqual({});
  });
});

describe('buildSavePayload — KV pairs serialize to records', () => {
  it('converts header pairs edits to a plain record in the save payload', () => {
    const edited: t.FlatConfigMap = {
      'mcpServers.srv.headers': [
        { key: 'Authorization', value: 'Bearer {{API_KEY}}', valueType: 'string' },
      ],
    };
    const { saves } = buildSavePayload(new Set(['mcpServers.srv.headers']), edited, new Set());
    expect(saves).toEqual([
      { fieldPath: 'mcpServers.srv.headers', value: { Authorization: 'Bearer {{API_KEY}}' } },
    ]);
  });

  it('converts pairs nested inside indexed array entries (azure additional params)', () => {
    const edited: t.FlatConfigMap = {
      'endpoints.azureOpenAI.groups.0': {
        group: 'my-group',
        addParams: [{ key: 'reasoning_effort', value: 'high', valueType: 'string' }],
      },
    };
    const { saves } = buildSavePayload(
      new Set(['endpoints.azureOpenAI.groups.0']),
      edited,
      new Set(),
    );
    expect(saves).toEqual([
      {
        fieldPath: 'endpoints.azureOpenAI.groups.0',
        value: { group: 'my-group', addParams: { reasoning_effort: 'high' } },
      },
    ]);
  });
});

describe('serializeModalValue', () => {
  it('serializes record-control pairs to a plain record', () => {
    const pairs = [{ key: 'Authorization', value: 'Bearer {{API_KEY}}', valueType: 'string' }];
    expect(serializeModalValue('record', pairs)).toEqual({ Authorization: 'Bearer {{API_KEY}}' });
  });

  it('passes an untouched empty record default through unchanged', () => {
    expect(serializeModalValue('record', {})).toEqual({});
  });

  it('leaves array-control values untouched even when elements look pair-like', () => {
    const value = [{ key: 'id', value: 'x', enabled: true }];
    expect(serializeModalValue('array', value)).toBe(value);
    expect(serializeModalValue('array-object', value)).toBe(value);
  });
});
