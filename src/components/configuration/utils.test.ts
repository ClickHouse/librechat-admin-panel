import { describe, it, expect } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type * as t from '@/types';
import {
  getControlType,
  getEnumOptions,
  getArrayItemType,
  splitUnionTypes,
  partitionScopeResetPaths,
  mergeIndexedArrayEdits,
  detectStaleContainerEdits,
  buildSavePayload,
  applyConfigEdit,
  applyConfigReset,
  withLangfuseConfiguredPath,
  installIfNewer,
  versionedStructuralSharing,
} from './utils';
import { createField } from '@/test/fixtures';
import { flattenObject } from '@/utils';

describe('applyConfigReset', () => {
  it('preserves the existing reset-then-edit behavior for sequential scoped saves', () => {
    const parent = 'speech.speechTab.textToSpeech';
    const reset = applyConfigReset({}, parent);
    expect(
      applyConfigEdit(reset, `${parent}.voice`, 'nova', {}, new Set(), new Set(), true),
    ).toEqual({
      [parent]: undefined,
      [`${parent}.voice`]: 'nova',
    });
  });

  it('keeps a parent reset intact when a descendant edit cannot be encoded atomically', () => {
    const parent = 'speech.speechTab.textToSpeech';
    const reset = applyConfigReset({}, parent);
    const next = applyConfigEdit(reset, `${parent}.voice`, 'nova', {}, new Set(), new Set());
    expect(next).toBe(reset);
    expect(buildSavePayload(new Set(Object.keys(next)), next, new Set(), new Set())).toEqual({
      touched: [parent],
      saves: [],
      resets: [parent],
    });
  });

  it('supersedes pending descendants and sends only the explicit parent reset', () => {
    const parent = 'speech.speechTab.textToSpeech';
    const prev: t.FlatConfigMap = {
      [`${parent}.voice`]: 'nova',
      [`${parent}.languageTTS`]: 'en',
      'speech.speechTab.speechToText': false,
    };
    const next = applyConfigReset(prev, parent);
    expect(next).toEqual({ [parent]: undefined, 'speech.speechTab.speechToText': false });
    expect(prev[`${parent}.voice`]).toBe('nova');
    expect(buildSavePayload(new Set(Object.keys(next)), next, new Set(), new Set())).toEqual({
      touched: Object.keys(next),
      saves: [{ fieldPath: 'speech.speechTab.speechToText', value: false }],
      resets: [parent],
    });
  });

  it('keeps an explicit reset for a redacted secret with no baseline value', () => {
    expect(applyConfigReset({}, 'ocr.apiKey')).toEqual({ 'ocr.apiKey': undefined });
  });

  it('removes a pending ancestor value but preserves an already-pending ancestor reset', () => {
    expect(applyConfigReset({ speech: { speechTab: true } }, 'speech.speechTab')).toEqual({
      'speech.speechTab': undefined,
    });
    expect(applyConfigReset({ speech: undefined }, 'speech.speechTab')).toEqual({
      speech: undefined,
    });
  });
});

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

describe('withLangfuseConfiguredPath', () => {
  it('includes a configured dedicated connection without mutating base paths', () => {
    const basePaths = new Set(['interface.theme']);

    const paths = withLangfuseConfiguredPath(basePaths, true);

    expect(paths).toEqual(new Set(['interface.theme', 'langfuse.enabled']));
    expect(basePaths).toEqual(new Set(['interface.theme']));
  });

  it('does not mark an unconfigured connection', () => {
    expect(withLangfuseConfiguredPath(new Set(['interface.theme']), false)).toEqual(
      new Set(['interface.theme']),
    );
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

describe('detectStaleContainerEdits', () => {
  it('keeps an indexed edit whose target item did not change', () => {
    const old = flattenObject({
      endpoints: { custom: [{ name: 'A', baseURL: 'https://a.example.com' }] },
    });
    const fresh = flattenObject({
      endpoints: { custom: [{ name: 'A', baseURL: 'https://a.example.com' }] },
    });
    const editedValues = { 'endpoints.custom.0': { name: 'A-edited' } };
    const stale = detectStaleContainerEdits(
      new Set(['endpoints.custom.0']),
      editedValues,
      old,
      fresh,
      new Set(),
    );
    expect(stale).toEqual([]);
  });

  it('drops an indexed edit whose position now holds a different item after a reorder', () => {
    // Admin edited item "A" while it was at index 0; another admin reordered
    // the array so "C" now sits at index 0 — reapplying by index 0 would
    // silently overwrite "C" with the admin's edited "A".
    const old = flattenObject({
      endpoints: {
        custom: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
      },
    });
    const fresh = flattenObject({
      endpoints: {
        custom: [{ name: 'C' }, { name: 'A' }, { name: 'B' }],
      },
    });
    const editedValues = { 'endpoints.custom.0': { name: 'A-edited' } };
    const stale = detectStaleContainerEdits(
      new Set(['endpoints.custom.0']),
      editedValues,
      old,
      fresh,
      new Set(),
    );
    expect(stale).toEqual(['endpoints.custom.0']);
  });

  it('drops an indexed edit whose target item was removed, shortening the array', () => {
    const old = flattenObject({
      endpoints: { custom: [{ name: 'A' }, { name: 'B' }] },
    });
    const fresh = flattenObject({
      endpoints: { custom: [{ name: 'A' }] },
    });
    const editedValues = { 'endpoints.custom.1': { name: 'B-edited' } };
    const stale = detectStaleContainerEdits(
      new Set(['endpoints.custom.1']),
      editedValues,
      old,
      fresh,
      new Set(),
    );
    expect(stale).toEqual(['endpoints.custom.1']);
  });

  it('ignores non-indexed, non-array touched paths', () => {
    const old = flattenObject({ cache: true, endpoints: { custom: [{ name: 'A' }] } });
    const fresh = flattenObject({ cache: false, endpoints: { custom: [{ name: 'A' }] } });
    const editedValues = { cache: false, 'endpoints.custom.0': { name: 'A-edited' } };
    const stale = detectStaleContainerEdits(
      new Set(['cache', 'endpoints.custom.0']),
      editedValues,
      old,
      fresh,
      new Set(),
    );
    expect(stale).toEqual([]);
  });

  it('does not flag an edit when only sibling array entries changed', () => {
    const old = flattenObject({
      endpoints: { custom: [{ name: 'A' }, { name: 'B' }] },
    });
    const fresh = flattenObject({
      endpoints: { custom: [{ name: 'A' }, { name: 'B-renamed' }] },
    });
    const editedValues = { 'endpoints.custom.0': { name: 'A-edited' } };
    const stale = detectStaleContainerEdits(
      new Set(['endpoints.custom.0']),
      editedValues,
      old,
      fresh,
      new Set(),
    );
    expect(stale).toEqual([]);
  });

  it('keeps a whole-array add/remove draft when the underlying array did not change', () => {
    // Admin removed item "B" from the array as it existed on the old baseline;
    // an unrelated field changed elsewhere, triggering the conflict, but this
    // array itself is untouched — the precomputed draft is still valid.
    const old = flattenObject({
      endpoints: { custom: [{ name: 'A' }, { name: 'B' }] },
    });
    const fresh = flattenObject({
      endpoints: { custom: [{ name: 'A' }, { name: 'B' }] },
    });
    const editedValues = { 'endpoints.custom': [{ name: 'A' }] };
    const stale = detectStaleContainerEdits(
      new Set(['endpoints.custom']),
      editedValues,
      old,
      fresh,
      new Set(),
    );
    expect(stale).toEqual([]);
  });

  it('drops a whole-array add/remove draft when the underlying array changed underneath it', () => {
    // Admin removed item "B" (draft = [A]) computed from the old array
    // [A, B]. Another admin concurrently added "C", so the live array is now
    // [A, B, C] — replaying [A] would silently drop the other admin's "C".
    const old = flattenObject({
      endpoints: { custom: [{ name: 'A' }, { name: 'B' }] },
    });
    const fresh = flattenObject({
      endpoints: { custom: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] },
    });
    const editedValues = { 'endpoints.custom': [{ name: 'A' }] };
    const stale = detectStaleContainerEdits(
      new Set(['endpoints.custom']),
      editedValues,
      old,
      fresh,
      new Set(),
    );
    expect(stale).toEqual(['endpoints.custom']);
  });

  it('drops a whole-array add draft when another admin removed an item concurrently', () => {
    const old = flattenObject({
      endpoints: { custom: [{ name: 'A' }] },
    });
    const fresh = flattenObject({
      endpoints: { custom: [] },
    });
    const editedValues = { 'endpoints.custom': [{ name: 'new' }, { name: 'A' }] };
    const stale = detectStaleContainerEdits(
      new Set(['endpoints.custom']),
      editedValues,
      old,
      fresh,
      new Set(),
    );
    expect(stale).toEqual(['endpoints.custom']);
  });

  it('ignores a touched path whose draft value is a scalar, not a container', () => {
    const old = flattenObject({ cache: false });
    const fresh = flattenObject({ cache: true });
    const editedValues = { cache: false };
    const stale = detectStaleContainerEdits(
      new Set(['cache']),
      editedValues,
      old,
      fresh,
      new Set(),
    );
    expect(stale).toEqual([]);
  });

  it('keeps a whole-record draft when no key in the record changed underneath it', () => {
    const old = flattenObject({ headers: { a: '1', b: '2' } });
    const fresh = flattenObject({ headers: { a: '1', b: '2' } });
    const editedValues = { headers: { a: '1', b: '2', c: '3' } };
    const stale = detectStaleContainerEdits(
      new Set(['headers']),
      editedValues,
      old,
      fresh,
      new Set(),
    );
    expect(stale).toEqual([]);
  });

  it('drops a whole-record draft when a different key in the record changed underneath it', () => {
    // Admin added key "c" to the record as it existed on the old baseline
    // (draft = { a: '1', b: '2', c: '3' }). Another admin concurrently
    // changed key "b" — replaying the draft would silently overwrite that
    // change back to the old value.
    const old = flattenObject({ headers: { a: '1', b: '2' } });
    const fresh = flattenObject({ headers: { a: '1', b: 'changed-by-other-admin' } });
    const editedValues = { headers: { a: '1', b: '2', c: '3' } };
    const stale = detectStaleContainerEdits(
      new Set(['headers']),
      editedValues,
      old,
      fresh,
      new Set(),
    );
    expect(stale).toEqual(['headers']);
  });

  it('drops a whole-record draft when another admin added a new key concurrently', () => {
    const old = flattenObject({ headers: { a: '1' } });
    const fresh = flattenObject({ headers: { a: '1', b: 'added-by-other-admin' } });
    const editedValues = { headers: { a: '1-edited' } };
    const stale = detectStaleContainerEdits(
      new Set(['headers']),
      editedValues,
      old,
      fresh,
      new Set(),
    );
    expect(stale).toEqual(['headers']);
  });

  it('drops a whole-record draft when another admin removed a key concurrently', () => {
    const old = flattenObject({ headers: { a: '1', b: '2' } });
    const fresh = flattenObject({ headers: { a: '1' } });
    const editedValues = { headers: { a: '1', b: '2', c: '3' } };
    const stale = detectStaleContainerEdits(
      new Set(['headers']),
      editedValues,
      old,
      fresh,
      new Set(),
    );
    expect(stale).toEqual(['headers']);
  });

  it('keeps a whole-record draft when the record was and remains empty', () => {
    const old = flattenObject({ headers: {} });
    const fresh = flattenObject({ headers: {} });
    const editedValues = { headers: { a: '1' } };
    const stale = detectStaleContainerEdits(
      new Set(['headers']),
      editedValues,
      old,
      fresh,
      new Set(),
    );
    expect(stale).toEqual([]);
  });

  it('drops an array reset when the underlying array changed underneath it', () => {
    // Admin reset (deleted the override for) endpoints.custom as it existed on
    // the old baseline. Another admin concurrently added an entry — replaying
    // the reset would delete that entry along with everything else, since
    // reset carries no value to diff and previously bypassed this check
    // entirely (editedValues[path] === undefined matched neither the
    // Array.isArray nor the isPlainObjectValue branch).
    const old = flattenObject({
      endpoints: { custom: [{ name: 'A' }, { name: 'B' }] },
    });
    const fresh = flattenObject({
      endpoints: { custom: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] },
    });
    const editedValues = { 'endpoints.custom': undefined };
    const stale = detectStaleContainerEdits(
      new Set(['endpoints.custom']),
      editedValues,
      old,
      fresh,
      new Set(),
    );
    expect(stale).toEqual(['endpoints.custom']);
  });

  it('keeps an array reset when the underlying array did not change', () => {
    const old = flattenObject({
      endpoints: { custom: [{ name: 'A' }, { name: 'B' }] },
    });
    const fresh = flattenObject({
      endpoints: { custom: [{ name: 'A' }, { name: 'B' }] },
    });
    const editedValues = { 'endpoints.custom': undefined };
    const stale = detectStaleContainerEdits(
      new Set(['endpoints.custom']),
      editedValues,
      old,
      fresh,
      new Set(),
    );
    expect(stale).toEqual([]);
  });

  it('drops a record reset when a key in the record changed underneath it', () => {
    // Same bypass as the array case, for a whole-record reset (e.g. resetting
    // mcpServers back to its YAML default): a reset's draft value is
    // `undefined`, which flattenObject never represents at a non-empty
    // record's own path either, so the container kind has to be inferred from
    // the baselines instead of the draft value.
    const old = flattenObject({ headers: { a: '1', b: '2' } });
    const fresh = flattenObject({ headers: { a: '1', b: 'changed-by-other-admin' } });
    const editedValues = { headers: undefined };
    const stale = detectStaleContainerEdits(
      new Set(['headers']),
      editedValues,
      old,
      fresh,
      new Set(),
    );
    expect(stale).toEqual(['headers']);
  });

  it('keeps a record reset when no key in the record changed underneath it', () => {
    const old = flattenObject({ headers: { a: '1', b: '2' } });
    const fresh = flattenObject({ headers: { a: '1', b: '2' } });
    const editedValues = { headers: undefined };
    const stale = detectStaleContainerEdits(
      new Set(['headers']),
      editedValues,
      old,
      fresh,
      new Set(),
    );
    expect(stale).toEqual([]);
  });

  it('keeps a scalar reset regardless of what the underlying value changed to', () => {
    // Deleting one layer's override is well-defined and safe no matter what
    // changed underneath — it only reveals whatever the next layer says now.
    // Unlike a container, there's no "wrong item" or "silently overwrites a
    // sibling" risk a scalar reset could reintroduce.
    const old = flattenObject({ cache: false });
    const fresh = flattenObject({ cache: true });
    const editedValues = { cache: undefined };
    const stale = detectStaleContainerEdits(
      new Set(['cache']),
      editedValues,
      old,
      fresh,
      new Set(),
    );
    expect(stale).toEqual([]);
  });

  describe('secret-bearing containers', () => {
    // A redacted read deletes hidden credential values rather than masking
    // them, so a concurrent change to ONLY a hidden credential inside a
    // container produces identical flattened old/new baselines here — the
    // structural checks above can never see it. These tests use secretFieldPaths
    // to force staleness regardless of what the (necessarily blind) structural
    // comparison finds.
    const secretFieldPaths = new Set(['endpoints.custom.apiKey', 'endpoints.custom.headers.*']);

    it('drops a whole-array reset even though the redacted baselines compare equal, when the array is secret-bearing', () => {
      // Admin A queues a reset of endpoints.custom. Admin B concurrently
      // changes only an encrypted headers.Authorization value on one entry —
      // invisible to both baselines, which both show headers: {}.
      const old = flattenObject({
        endpoints: { custom: [{ name: 'A', headers: {} }] },
      });
      const fresh = flattenObject({
        endpoints: { custom: [{ name: 'A', headers: {} }] },
      });
      const editedValues = { 'endpoints.custom': undefined };
      const stale = detectStaleContainerEdits(
        new Set(['endpoints.custom']),
        editedValues,
        old,
        fresh,
        secretFieldPaths,
      );
      expect(stale).toEqual(['endpoints.custom']);
    });

    it('drops a whole-array add/remove draft even though the redacted baselines compare equal, when the array is secret-bearing', () => {
      const old = flattenObject({
        endpoints: { custom: [{ name: 'A', headers: {} }] },
      });
      const fresh = flattenObject({
        endpoints: { custom: [{ name: 'A', headers: {} }] },
      });
      const editedValues = { 'endpoints.custom': [{ name: 'A', headers: {} }, { name: 'B' }] };
      const stale = detectStaleContainerEdits(
        new Set(['endpoints.custom']),
        editedValues,
        old,
        fresh,
        secretFieldPaths,
      );
      expect(stale).toEqual(['endpoints.custom']);
    });

    it('drops an indexed edit even though the target item compares equal, when its array is secret-bearing', () => {
      const old = flattenObject({
        endpoints: { custom: [{ name: 'A', headers: {} }] },
      });
      const fresh = flattenObject({
        endpoints: { custom: [{ name: 'A', headers: {} }] },
      });
      const editedValues = { 'endpoints.custom.0': { name: 'A-edited' } };
      const stale = detectStaleContainerEdits(
        new Set(['endpoints.custom.0']),
        editedValues,
        old,
        fresh,
        secretFieldPaths,
      );
      expect(stale).toEqual(['endpoints.custom.0']);
    });

    it('drops a whole-record draft even though the redacted baselines compare equal, when the record itself is a registered secret container', () => {
      const old = flattenObject({ endpoints: { custom: [{ name: 'A', headers: {} }] } });
      const fresh = flattenObject({ endpoints: { custom: [{ name: 'A', headers: {} }] } });
      const editedValues = { 'endpoints.custom.0.headers': { Authorization: 'Bearer new' } };
      const stale = detectStaleContainerEdits(
        new Set(['endpoints.custom.0.headers']),
        editedValues,
        old,
        fresh,
        secretFieldPaths,
      );
      expect(stale).toEqual(['endpoints.custom.0.headers']);
    });

    it('drops a record reset even though the redacted baselines compare equal, when the record itself is a registered secret container', () => {
      const old = flattenObject({ endpoints: { custom: [{ name: 'A', headers: {} }] } });
      const fresh = flattenObject({ endpoints: { custom: [{ name: 'A', headers: {} }] } });
      const editedValues = { 'endpoints.custom.0.headers': undefined };
      const stale = detectStaleContainerEdits(
        new Set(['endpoints.custom.0.headers']),
        editedValues,
        old,
        fresh,
        secretFieldPaths,
      );
      expect(stale).toEqual(['endpoints.custom.0.headers']);
    });

    it('does not drop a non-secret-bearing container just because unrelated secretFieldPaths exist', () => {
      const old = flattenObject({ endpoints: { custom: [{ name: 'A' }] } });
      const fresh = flattenObject({ endpoints: { custom: [{ name: 'A' }] } });
      const editedValues = { cache: false };
      const stale = detectStaleContainerEdits(
        new Set(['cache']),
        editedValues,
        old,
        fresh,
        secretFieldPaths,
      );
      expect(stale).toEqual([]);
    });

    it('always treats an mcpServers sub-object write as secret-bearing, even with no matching schema-registered secret path', () => {
      // mcpServers credential sub-paths are keyed by an admin-chosen server
      // name, which schema-derived secretFieldPaths can't express — so
      // mcpServers.* is always secret-bearing regardless of what's registered.
      const old = flattenObject({ mcpServers: { foo: { type: 'sse', oauth: {} } } });
      const fresh = flattenObject({ mcpServers: { foo: { type: 'sse', oauth: {} } } });
      const editedValues = {
        'mcpServers.foo.oauth': { scope: 'read', __previousIdentity: 'bar' },
      };
      const stale = detectStaleContainerEdits(
        new Set(['mcpServers.foo.oauth']),
        editedValues,
        old,
        fresh,
        new Set(),
      );
      expect(stale).toEqual(['mcpServers.foo.oauth']);
    });

    it('drops every touched path for an MCP rename once any one of them is flagged stale, including scalar leaves that never enter any branch above', () => {
      // An MCP rename submits several INDEPENDENT touched paths: the
      // destination's secret sub-object (oauth), the destination's plain
      // scalar leaves (url, type), the source's per-leaf resets, and the
      // source's whole-entry reset. Only the object write and the resets
      // reach the checks above on their own -- mcpServers.B.url/.type are
      // plain strings, never containers, so detectStaleContainerEdits would
      // otherwise never even look at them, leaving an inconsistent draft
      // (an uncredentialed "B" with its other fields intact, and "A" only
      // partially cleaned up) after the rebase.
      const old = flattenObject({});
      const fresh = flattenObject({});
      const editedValues = {
        'mcpServers.B.oauth': { scope: 'read', __previousIdentity: 'A' },
        'mcpServers.B.url': 'https://new.example.com',
        'mcpServers.B.type': 'sse',
        'mcpServers.A.oauth': undefined,
        'mcpServers.A.url': undefined,
        'mcpServers.A': undefined,
      };
      const stale = detectStaleContainerEdits(
        new Set(Object.keys(editedValues)),
        editedValues,
        old,
        fresh,
        new Set(),
      );
      expect(new Set(stale)).toEqual(new Set(Object.keys(editedValues)));
    });

    it("drops a rename destination's scalar-only leaves even when nothing about it ever reaches the branches above", () => {
      // Admin renames "A" to "B", but "B" has no oauth/apiKey/headers at
      // all -- only scalar leaves (url, type) are touched. Nothing about
      // "B" ever enters a container-operation branch above, so there is
      // nothing in `stale` to seed the grouping pass from B's own paths;
      // it must instead be seeded because it's a name that didn't exist in
      // the pre-edit baseline, appearing alongside "A"'s entry vanishing.
      const old = flattenObject({
        mcpServers: { A: { url: 'https://old.example.com', type: 'sse' } },
      });
      const fresh = flattenObject({
        mcpServers: { A: { url: 'https://old.example.com', type: 'sse' } },
      });
      const editedValues = {
        'mcpServers.B.url': 'https://new.example.com',
        'mcpServers.B.type': 'sse',
        'mcpServers.A.url': undefined,
        'mcpServers.A.type': undefined,
        'mcpServers.A': undefined,
      };
      const stale = detectStaleContainerEdits(
        new Set(Object.keys(editedValues)),
        editedValues,
        old,
        fresh,
        new Set(),
      );
      expect(new Set(stale)).toEqual(new Set(Object.keys(editedValues)));
    });

    it('does not drop an unrelated MCP server whose own paths were never flagged stale', () => {
      const old = flattenObject({});
      const fresh = flattenObject({});
      const editedValues = {
        'mcpServers.B.oauth': { scope: 'read', __previousIdentity: 'A' },
        'mcpServers.other.url': 'https://unrelated.example.com',
      };
      const stale = detectStaleContainerEdits(
        new Set(Object.keys(editedValues)),
        editedValues,
        old,
        fresh,
        new Set(),
      );
      expect(stale).toEqual(['mcpServers.B.oauth']);
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

describe('buildSavePayload — MCP remove and recreate', () => {
  it('submits a whole-entry replacement without overlapping resets or old credentials', () => {
    const baseline = flattenObject({
      mcpServers: {
        remote: { type: 'sse', url: 'https://old.example.com', timeout: 9000 },
      },
    });
    let edits = applyConfigEdit(
      {},
      'mcpServers.remote',
      undefined,
      baseline,
      new Set(),
      new Set(['mcpServers.remote']),
    );
    for (const [path, value] of Object.entries({
      'mcpServers.remote.type': 'sse',
      'mcpServers.remote.url': 'https://new.example.com',
      'mcpServers.remote.oauth': { client_id: 'new-client' },
    })) {
      edits = applyConfigEdit(edits, path, value, baseline, new Set(), new Set());
    }
    const payload = buildSavePayload(new Set(Object.keys(edits)), edits, new Set(), new Set());
    expect(payload.resets).toEqual([]);
    expect(payload.saves).toEqual([
      {
        fieldPath: 'mcpServers.remote',
        value: {
          type: 'sse',
          url: 'https://new.example.com',
          oauth: { client_id: 'new-client', __previousIdentity: null },
          headers: { __previousIdentity: null },
          oauth_headers: { __previousIdentity: null },
        },
      },
    ]);
  });

  it('preserves rename origins and unrelated edits when a deleted name is reused', () => {
    const edits: t.FlatConfigMap = {
      'mcpServers.remote': undefined,
      'mcpServers.source': undefined,
      'mcpServers.remote.type': 'sse',
      'mcpServers.remote.url': 'https://source.example.com',
      'mcpServers.remote.oauth': { client_id: 'source', __previousIdentity: 'source' },
      cache: true,
    };
    const payload = buildSavePayload(new Set(Object.keys(edits)), edits, new Set(), new Set());
    expect(payload.resets).toEqual(['mcpServers.source']);
    expect(payload.saves).toContainEqual({ fieldPath: 'cache', value: true });
    expect(payload.saves).toContainEqual({
      fieldPath: 'mcpServers.remote',
      value: {
        type: 'sse',
        url: 'https://source.example.com',
        oauth: { client_id: 'source', __previousIdentity: 'source' },
        headers: { __previousIdentity: 'source' },
        oauth_headers: { __previousIdentity: 'source' },
      },
    });
  });

  it('leaves a standalone delete and ordinary leaf saves unchanged', () => {
    const edits = {
      'mcpServers.remote': undefined,
      'mcpServers.other.url': 'https://new.example.com',
    };
    expect(buildSavePayload(new Set(Object.keys(edits)), edits, new Set(), new Set())).toEqual({
      touched: Object.keys(edits),
      saves: [{ fieldPath: 'mcpServers.other.url', value: 'https://new.example.com' }],
      resets: ['mcpServers.remote'],
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
  const noRecordFields = new Set<string>();

  it('submitting without touching the masked secret excludes it from the payload', () => {
    const edited = applyConfigEdit(
      {},
      'ocr.baseURL',
      'https://new.example',
      baseline,
      noIntermediates,
      noContainers,
    );
    const { saves, resets } = buildSavePayload(
      new Set(['ocr.baseURL']),
      edited,
      schemaPaths,
      noRecordFields,
    );
    expect(saves).toEqual([{ fieldPath: 'ocr.baseURL', value: 'https://new.example' }]);
    expect(resets).toEqual([]);
    expect(saves.some((s) => s.fieldPath === 'ocr.apiKey')).toBe(false);
    expect(JSON.stringify(saves)).not.toContain('sk-mist...4321');
  });

  it('submitting with no touched paths produces an empty payload', () => {
    const { touched, saves, resets } = buildSavePayload(new Set(), {}, schemaPaths, noRecordFields);
    expect(touched).toEqual([]);
    expect(saves).toEqual([]);
    expect(resets).toEqual([]);
  });

  it('a display companion leaf path never survives as a save entry', () => {
    const { saves } = buildSavePayload(
      new Set(['ocr.apiKeyPreview']),
      { 'ocr.apiKeyPreview': 'sk-mist...4321' },
      schemaPaths,
      noRecordFields,
    );
    expect(saves).toEqual([]);
  });

  it('display companions nested in object values are stripped', () => {
    const edited = {
      'speech.tts.openai': { apiKeyPreview: 'sk-abc...1111', model: 'tts-1' },
    };
    const { saves } = buildSavePayload(
      new Set(['speech.tts.openai']),
      edited,
      schemaPaths,
      noRecordFields,
    );
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
    const { saves } = buildSavePayload(
      new Set(['ocr.apiKey']),
      edited,
      schemaPaths,
      noRecordFields,
    );
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
      noRecordFields,
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
    const { resets } = buildSavePayload(
      new Set(['ocr.apiKey']),
      edited,
      schemaPaths,
      noRecordFields,
    );
    expect(resets).toEqual(['ocr.apiKey']);
  });

  it('resetting a masked secret produces a reset for the real path, not a save', () => {
    const edited: t.FlatConfigMap = { 'ocr.apiKey': undefined };
    const { saves, resets } = buildSavePayload(
      new Set(['ocr.apiKey']),
      edited,
      schemaPaths,
      noRecordFields,
    );
    expect(saves).toEqual([]);
    expect(resets).toEqual(['ocr.apiKey']);
  });
});

describe('installIfNewer', () => {
  const queryKey = ['baseConfig'];
  const getVersion = (value: { dbConfigVersion: number }) => value.dbConfigVersion;

  it('installs the first read into an empty cache regardless of version', () => {
    const queryClient = new QueryClient();
    const result = installIfNewer(queryClient, queryKey, { dbConfigVersion: 3 }, getVersion);
    expect(result).toEqual({ dbConfigVersion: 3 });
    expect(queryClient.getQueryData(queryKey)).toEqual({ dbConfigVersion: 3 });
  });

  it('installs a newer read over an older cached value', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKey, { dbConfigVersion: 3 });
    const result = installIfNewer(queryClient, queryKey, { dbConfigVersion: 9 }, getVersion);
    expect(result).toEqual({ dbConfigVersion: 9 });
    expect(queryClient.getQueryData(queryKey)).toEqual({ dbConfigVersion: 9 });
  });

  it('two independent reads resolving out of order never let the cache regress', () => {
    // Simulates ConfigPage's rebase and LangfuseRenderer's post-mutation
    // refresh racing each other outside any single request's lifecycle: two
    // wholly separate direct calls to the same underlying endpoint, with no
    // shared in-flight request for either to join or cancel. The newer
    // snapshot (v10) resolves and installs first; the older one (v9), read
    // earlier but settling later, must not be allowed to overwrite it.
    const queryClient = new QueryClient();
    const newer = installIfNewer(queryClient, queryKey, { dbConfigVersion: 10 }, getVersion);
    expect(newer).toEqual({ dbConfigVersion: 10 });

    const olderArrivingLate = installIfNewer(
      queryClient,
      queryKey,
      { dbConfigVersion: 9 },
      getVersion,
    );

    // The stale read is told it lost -- it gets back the winning (newer)
    // value, not its own -- and the cache still holds the newer snapshot.
    expect(olderArrivingLate).toEqual({ dbConfigVersion: 10 });
    expect(queryClient.getQueryData(queryKey)).toEqual({ dbConfigVersion: 10 });
  });

  it('installs a read whose version exactly matches the cached one (no regression, no-op either way)', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKey, { dbConfigVersion: 5 });
    const result = installIfNewer(queryClient, queryKey, { dbConfigVersion: 5 }, getVersion);
    expect(result).toEqual({ dbConfigVersion: 5 });
    expect(queryClient.getQueryData(queryKey)).toEqual({ dbConfigVersion: 5 });
  });

  // `dbConfigVersion: null` means "no base config document exists yet" (see
  // getBaseConfigFn). A numeric version always outranks null: once a
  // document exists, a late-arriving pre-creation read must never regress
  // the cache back to "no document." The fresh arrival only wins by default
  // when there's no numeric version on either side to compare against.
  const getNullableVersion = (value: { dbConfigVersion: number | null }) => value.dbConfigVersion;

  it('rejects a null-versioned read arriving after a numeric cached version', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKey, { dbConfigVersion: 5 });
    const result = installIfNewer(
      queryClient,
      queryKey,
      { dbConfigVersion: null },
      getNullableVersion,
    );
    expect(result).toEqual({ dbConfigVersion: 5 });
    expect(queryClient.getQueryData(queryKey)).toEqual({ dbConfigVersion: 5 });
  });

  it('installs a numeric read over a null cached version', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKey, { dbConfigVersion: null });
    const result = installIfNewer(
      queryClient,
      queryKey,
      { dbConfigVersion: 1 },
      getNullableVersion,
    );
    expect(result).toEqual({ dbConfigVersion: 1 });
    expect(queryClient.getQueryData(queryKey)).toEqual({ dbConfigVersion: 1 });
  });

  it('installs a null-versioned read when the cache itself has a null version (nothing to compare)', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKey, { dbConfigVersion: null });
    const result = installIfNewer(
      queryClient,
      queryKey,
      { dbConfigVersion: null },
      getNullableVersion,
    );
    expect(result).toEqual({ dbConfigVersion: null });
    expect(queryClient.getQueryData(queryKey)).toEqual({ dbConfigVersion: null });
  });

  it('accepts a lower version when the candidate belongs to a different tenant', () => {
    const queryClient = new QueryClient();
    const current = { dbConfigVersion: 20, effectiveTenantId: 'tenant-a' };
    const candidate = { dbConfigVersion: 3, effectiveTenantId: 'tenant-b' };
    queryClient.setQueryData(queryKey, current);

    const result = installIfNewer(
      queryClient,
      queryKey,
      candidate,
      (value) => value.dbConfigVersion,
      (value) => value.effectiveTenantId,
    );

    expect(result).toEqual(candidate);
    expect(queryClient.getQueryData(queryKey)).toEqual(candidate);
  });
});

describe('versionedStructuralSharing', () => {
  const shareByVersion = versionedStructuralSharing(
    (value: { configVersion: number | null; value: string }) => value.configVersion,
  );

  it('keeps the cached snapshot when an older tracked result resolves later', () => {
    const current = { configVersion: 10, value: 'current' };
    expect(shareByVersion(current, { configVersion: 9, value: 'stale' })).toBe(current);
  });

  it('lets a newer tracked result replace the cached snapshot', () => {
    const current = { configVersion: 9, value: 'old' };
    expect(shareByVersion(current, { configVersion: 10, value: 'fresh' })).toEqual({
      configVersion: 10,
      value: 'fresh',
    });
  });

  it('does not let a null-versioned snapshot replace a numeric one', () => {
    const current = { configVersion: 1, value: 'created' };
    expect(shareByVersion(current, { configVersion: null, value: 'absent' })).toBe(current);
  });

  it('accepts a lower version when the result moves to another tenant', () => {
    const shareByTenantAndVersion = versionedStructuralSharing(
      (value: { configVersion: number; effectiveTenantId: string }) => value.configVersion,
      (value) => value.effectiveTenantId,
    );
    const current = { configVersion: 20, effectiveTenantId: 'tenant-a' };
    const candidate = { configVersion: 3, effectiveTenantId: 'tenant-b' };

    expect(shareByTenantAndVersion(current, candidate)).toEqual(candidate);
  });
});
