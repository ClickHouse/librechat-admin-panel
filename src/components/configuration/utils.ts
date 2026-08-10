import type * as t from '@/types';
import { deepSerializeKVPairs, secretPathForPreviewPath, stripSecretPreviewValues } from '@/utils';

const INDEXED_ARRAY_PATH_RE = /^(.+)\.(\d+)$/;

/**
 * Builds the save payload from touched edits. Only admin-touched paths are
 * submitted, secret display companion paths are dropped, and display
 * companion strings nested inside object values are stripped — a masked
 * display value (`sk-mist...4321`) must never reach the backend as a value.
 */
export function buildSavePayload(
  touchedPaths: ReadonlySet<string>,
  editedValues: t.FlatConfigMap,
  schemaPaths: ReadonlySet<string>,
): t.SavePayload {
  const touched = [...touchedPaths].filter((p) => p in editedValues);
  const saves = touched
    .filter(
      (p) => editedValues[p] !== undefined && secretPathForPreviewPath(p, schemaPaths) == null,
    )
    .map((p) => ({
      fieldPath: p,
      value: stripSecretPreviewValues(deepSerializeKVPairs(editedValues[p]), p, schemaPaths),
    }));
  const resets = touched.filter((p) => editedValues[p] === undefined);
  return { touched, saves, resets };
}

/**
 * Builds the server calls that clear the admin-override layer for one entry,
 * reverting it to the YAML config. Record entries (`mcpServers.<key>`) unset
 * the whole override subtree. Array entries merged by name
 * (`endpoints.custom` + `itemName`) rewrite the stored override array without
 * the named item; when that item was the only one, the array path is unset
 * instead so no empty override lingers.
 */
export function buildEntryOverridesResetPlan(
  target: Pick<t.EntryResetTarget, 'fieldPath' | 'itemName'>,
  dbOverrides: Record<string, t.ConfigValue> | undefined,
  schemaPaths: ReadonlySet<string>,
): t.EntryResetPlan {
  if (target.itemName == null) {
    return { resetPaths: [target.fieldPath], saves: [] };
  }
  const overrideArray = toOverrideArraySource(lookupPath(dbOverrides, target.fieldPath));
  if (!overrideArray) {
    return { resetPaths: [], saves: [] };
  }
  const remaining = overrideArray.filter((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return true;
    return (item as Record<string, t.ConfigValue>).name !== target.itemName;
  });
  if (remaining.length === overrideArray.length) {
    return { resetPaths: [], saves: [] };
  }
  if (remaining.length === 0) {
    return { resetPaths: [target.fieldPath], saves: [] };
  }
  return {
    resetPaths: [],
    saves: [
      {
        fieldPath: target.fieldPath,
        value: stripSecretPreviewValues(remaining, target.fieldPath, schemaPaths),
      },
    ],
  };
}

const ARRAY_INDEX_KEY_RE = /^(0|[1-9]\d*)$/;

/**
 * Normalizes a stored array override into a dense array. Panels prior to #92
 * PATCHed indexed field paths (`endpoints.custom.2`) directly, and Mongo's
 * `$set` on a missing parent materializes those as a numeric-key object
 * (`{ '0': {...}, '2': {...} }`) rather than an array, so legacy override
 * documents can hold either shape. Holes from sparse indices are dropped.
 */
export function toOverrideArraySource(value: t.ConfigValue | undefined): t.ConfigValue[] | null {
  if (Array.isArray(value)) return [...value];
  if (!value || typeof value !== 'object') return null;
  const sparse: t.ConfigValue[] = [];
  for (const [key, entry] of Object.entries(value as Record<string, t.ConfigValue>)) {
    if (!ARRAY_INDEX_KEY_RE.test(key)) return null;
    sparse[Number(key)] = entry;
  }
  return sparse.filter((entry) => entry !== undefined);
}

/**
 * Derives the entry identities stored in the base override document, keyed by
 * section, so per-entry "reset to YAML" affordances only appear where
 * overrides actually exist. MCP servers key by record key; custom endpoints
 * key by item `name` (the merge identity), accepting both the array and
 * legacy numeric-key object storage shapes.
 */
export function collectEntryOverrideKeys(
  dbOverrides: Record<string, t.ConfigValue> | undefined,
): Record<string, Set<string>> {
  const result: Record<string, Set<string>> = {};
  if (!dbOverrides) return result;
  const mcp = dbOverrides.mcpServers;
  if (mcp && typeof mcp === 'object' && !Array.isArray(mcp)) {
    result.mcpServers = new Set(Object.keys(mcp as Record<string, t.ConfigValue>));
  }
  const custom = toOverrideArraySource(lookupPath(dbOverrides, 'endpoints.custom'));
  if (custom) {
    const names = new Set<string>();
    for (const item of custom) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const name = (item as Record<string, t.ConfigValue>).name;
      if (typeof name === 'string' && name) names.add(name);
    }
    result.endpoints = names;
  }
  return result;
}

/**
 * Runs a per-entry overrides reset against a freshly fetched override
 * document instead of the client cache. Another admin may have changed the
 * override array since this page loaded, and rewriting it from a stale
 * snapshot would silently discard their change (or resurrect a deleted
 * item); fetching immediately before building the plan shrinks the
 * read-modify-write window to the request itself. A target whose item no
 * longer exists in the fresh document resolves as a no-op success.
 */
export async function executeEntryOverridesReset(
  target: t.EntryResetTarget,
  schemaPaths: ReadonlySet<string>,
  deps: t.EntryResetDeps,
): Promise<void> {
  const overrides = await deps.fetchOverrides();
  const plan = buildEntryOverridesResetPlan(target, overrides, schemaPaths);
  if (plan.resetPaths.length > 0) {
    await Promise.all(plan.resetPaths.map((fieldPath) => deps.resetField(fieldPath)));
  }
  if (plan.saves.length > 0) {
    await deps.saveEntries(plan.saves);
  }
}

function lookupPath(
  obj: Record<string, t.ConfigValue> | undefined,
  path: string,
): t.ConfigValue | undefined {
  let cursor: t.ConfigValue | undefined = obj;
  for (const segment of path.split('.')) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, t.ConfigValue>)[segment];
  }
  return cursor;
}

export function inferKVType(v: t.ConfigValue): t.KVValueType {
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'object' && v !== null) return 'json';
  return 'string';
}

export function toKVPair(k: string, v: t.ConfigValue): t.KeyValuePair {
  const valueType = inferKVType(v);
  if (valueType === 'json') return { key: k, value: JSON.stringify(v, null, 2), valueType };
  return { key: k, value: typeof v === 'string' ? v : String(v ?? ''), valueType };
}

export function getControlType(field: t.SchemaField): t.ControlType {
  if (field.type === 'boolean') return 'toggle';
  if (field.type.startsWith('enum')) return 'select';
  if (field.type === 'number') return 'number';
  if (field.type === 'string' || field.type === 'any' || field.type.startsWith('literal(')) {
    return 'text';
  }
  if (field.type.startsWith('array') && field.children && field.children.length > 0)
    return 'array-object';
  if (field.type.startsWith('array')) return 'array';
  if (field.type === 'object' || field.isObject) return 'object';
  if (field.type === 'record' && field.recordValueType === 'complex') return 'record-object';
  if (field.type === 'record') return 'record';

  if (field.type.startsWith('union(')) {
    const types = splitUnionTypes(field.type);

    if (
      types.length === 2 &&
      types.includes('boolean') &&
      types.includes('object') &&
      field.children?.length
    ) {
      return 'switch-object';
    }
    if (types.length === 2 && types.includes('string') && types.includes('record')) {
      return 'text-record';
    }
    if (
      types.length === 2 &&
      types.includes('string') &&
      types.some((u) => u.startsWith('array'))
    ) {
      return 'text-record';
    }
    if (
      types.length === 2 &&
      types.some((u) => u.startsWith('array')) &&
      (types.includes('record') || types.every((u) => u.startsWith('array')))
    ) {
      return 'list-record';
    }

    if (types.every((u) => u.startsWith('literal('))) return 'select';
    if (types.some((u) => u.startsWith('enum(')) && !types.includes('string')) return 'select';
    if (types.includes('record') || types.some((u) => u.startsWith('array'))) return 'record';
    if (types.includes('string')) return 'text';
    if (types.includes('number')) return 'number';
    if (types.includes('boolean')) return 'toggle';
  }

  return 'record';
}

export function getEnumOptions(typeString: string): t.SelectOption[] {
  const enumMatch = typeString.match(/^enum\((.+)\)$/);
  if (enumMatch) {
    return enumMatch[1]
      .split('|')
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
      .map((entry) => {
        const eqIdx = entry.indexOf('=');
        if (eqIdx !== -1) {
          const label = entry.slice(0, eqIdx);
          const value = entry.slice(eqIdx + 1);
          return {
            label: label.charAt(0).toUpperCase() + label.slice(1).toLowerCase().replace(/_/g, ' '),
            value,
          };
        }
        return {
          label: entry.charAt(0).toUpperCase() + entry.slice(1).replace(/_/g, ' '),
          value: entry,
        };
      });
  }

  if (typeString.startsWith('union(')) {
    const types = splitUnionTypes(typeString);

    for (const u of types) {
      if (u.startsWith('enum(')) {
        const opts = getEnumOptions(u);
        if (opts.length > 0) return opts;
      }
    }

    const literalValues = types
      .map((u) => u.match(/^literal\((.+)\)$/)?.[1])
      .filter((v): v is string => v != null)
      .map((v) => v.replace(/^["']|["']$/g, ''));
    if (literalValues.length > 0) {
      return literalValues.map((value) => ({
        label: value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' '),
        value,
      }));
    }
  }

  return [];
}

/** Coerces a select value to its runtime type. Numeric enum values arrive as
 *  strings from the HTML select element but the Zod schema expects numbers. */
export function coerceEnumValue(value: string): string | number {
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

export function getArrayItemType(typeString: string): string {
  const match = typeString.match(/array<(.+)>/);
  return match ? match[1] : 'string';
}

export function isStringLikeItemType(itemType: string): boolean {
  if (itemType === 'string' || itemType === 'any' || itemType === 'unknown') return true;
  if (itemType.startsWith('enum(')) return true;
  if (itemType.startsWith('union(')) {
    const types = splitUnionTypes(itemType);
    return types.includes('string') || types.some((u) => u.startsWith('enum('));
  }
  return false;
}

const CONTROL_ORDER: Record<string, number> = {
  toggle: 0,
  'switch-object': 0,
  select: 1,
  number: 2,
  text: 3,
  'text-record': 3,
  array: 4,
  'list-record': 4,
  'array-object': 5,
  record: 5,
  'record-object': 5,
  nested: 6,
  unknown: 7,
};

export function controlSortKey(field: t.SchemaField): number {
  const control = getControlType(field);
  if (
    field.children &&
    field.children.length > 0 &&
    !field.isArray &&
    field.type !== 'record' &&
    control !== 'switch-object'
  ) {
    return CONTROL_ORDER.nested;
  }
  return CONTROL_ORDER[control] ?? CONTROL_ORDER.unknown;
}

/** Splits a `union(A | B | C)` type string into its variants. Expects the
 *  ` | ` (space-pipe-space) delimiter produced by `getZodTypeName`. Handles
 *  nested parens (e.g. `union(enum(a|b) | string)`) via depth tracking. */
export function splitUnionTypes(typeString: string): string[] {
  const inner = typeString.match(/^union\((.+)\)$/)?.[1];
  if (!inner) return [];

  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '(') depth++;
    else if (inner[i] === ')') depth--;
    else if (depth === 0 && inner[i] === '|' && inner[i - 1] === ' ' && inner[i + 1] === ' ') {
      parts.push(inner.slice(start, i - 1).trim());
      start = i + 2;
    }
  }
  parts.push(inner.slice(start).trim());
  return parts;
}

/** Count configured vs total leaf fields in a field tree. */
export function countConfigured(
  fields: t.SchemaField[],
  parentPath: string,
  configuredPaths?: Set<string>,
): { total: number; configured: number } {
  let total = 0;
  let configured = 0;
  for (const f of fields) {
    const p = `${parentPath}.${f.key}`;
    if (f.children?.length && !f.isArray && f.type !== 'record') {
      const sub = countConfigured(f.children, p, configuredPaths);
      total += sub.total;
      configured += sub.configured;
    } else {
      total++;
      if (configuredPaths?.has(p) || hasDescendant(p, configuredPaths)) configured++;
    }
  }
  return { total, configured };
}

/** Returns true if `paths` contains any key that is a descendant of `path`. */
export function hasDescendant(path: string, paths?: Set<string>): boolean {
  if (!paths) return false;
  const prefix = `${path}.`;
  for (const p of paths) {
    if (p.startsWith(prefix)) return true;
  }
  return false;
}

export function isMcpEntryPath(path: string): boolean {
  if (!path.startsWith('mcpServers.')) return false;
  const key = path.slice('mcpServers.'.length);
  return key.length > 0 && !key.includes('.');
}

export function partitionScopeResetPaths(
  paths: string[],
  inheritedMcpKeys: Set<string>,
): {
  resetPaths: string[];
  tombstonePaths: string[];
} {
  const resetPaths: string[] = [];
  const tombstonePaths: string[] = [];
  for (const path of paths) {
    const key = path.startsWith('mcpServers.') ? path.slice('mcpServers.'.length) : '';
    if (isMcpEntryPath(path) && inheritedMcpKeys.has(key)) {
      tombstonePaths.push(path);
    } else {
      resetPaths.push(path);
    }
  }
  return { resetPaths, tombstonePaths };
}

export function applyConfigEdit(
  prev: t.FlatConfigMap,
  path: string,
  value: t.ConfigValue,
  baseline: t.FlatConfigMap,
  baselineIntermediates: Set<string>,
  baselineContainerPaths: Set<string>,
): t.FlatConfigMap {
  const indexMatch = INDEXED_ARRAY_PATH_RE.exec(path);
  if (indexMatch) {
    const [, arrayPath, indexStr] = indexMatch;
    const pendingArray = prev[arrayPath];
    if (Array.isArray(pendingArray)) {
      const next = { ...prev };
      const arr = [...pendingArray];
      arr[Number(indexStr)] = value;
      next[arrayPath] = arr;
      for (const existing of Object.keys(next)) {
        if (existing.startsWith(`${arrayPath}.`)) delete next[existing];
      }
      return next;
    }
  }

  const baselineValue = baseline[path];
  const match =
    value === baselineValue ||
    (typeof value === 'object' &&
      typeof baselineValue === 'object' &&
      JSON.stringify(value) === JSON.stringify(baselineValue));
  const isContainerDelete =
    value === undefined && (baselineIntermediates.has(path) || baselineContainerPaths.has(path));
  const hasPendingAncestorDelete = (() => {
    let lastDot = path.lastIndexOf('.');
    while (lastDot > 0) {
      const ancestor = path.slice(0, lastDot);
      if (ancestor in prev && prev[ancestor] === undefined) return true;
      lastDot = ancestor.lastIndexOf('.');
    }
    return false;
  })();
  if (match && !isContainerDelete && !hasPendingAncestorDelete) {
    const next = { ...prev };
    delete next[path];
    return next;
  }
  const next = { ...prev, [path]: value };
  if (Array.isArray(value)) {
    const prefix = `${path}.`;
    for (const k of Object.keys(next)) {
      if (k.startsWith(prefix) && INDEXED_ARRAY_PATH_RE.test(k)) delete next[k];
    }
  }
  if (indexMatch) delete next[indexMatch[1]];
  for (const existing of Object.keys(next)) {
    if (existing === path) continue;
    const newIsDescendant = path.startsWith(`${existing}.`);
    const newIsAncestor = existing.startsWith(`${path}.`);
    if (newIsDescendant && next[existing] === undefined) continue;
    if (newIsDescendant || newIsAncestor) {
      delete next[existing];
    }
  }
  return next;
}

/**
 * Merge indexed-array edits (entries whose flat path ends in `.<digit>`) into
 * a config tree. Each indexed edit's value replaces the array element at that
 * index; the array's parent path is auto-created if absent so newly-introduced
 * sections (e.g. `modelSpecs` not present in `librechat.yaml`) merge in at the
 * correct nesting level rather than getting written to the wrong parent.
 *
 * Skips an edit when an intermediate path holds a primitive or array value,
 * since overwriting those with a fresh object would silently destroy live
 * baseline data. Caller is responsible for filtering `editedValues` down to
 * indexed entries before passing.
 */
export function mergeIndexedArrayEdits(
  baseline: Record<string, t.ConfigValue>,
  indexedEdits: Array<[string, t.ConfigValue]>,
): Record<string, t.ConfigValue> {
  const merged = { ...baseline };
  for (const [path, value] of indexedEdits) {
    const segments = path.split('.');
    const index = Number(segments.pop()!);
    const arrayPath = segments;
    let parent: Record<string, t.ConfigValue> = merged;
    let bailed = false;
    for (let i = 0; i < arrayPath.length - 1; i++) {
      const seg = arrayPath[i];
      const existing = parent[seg];
      if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        parent[seg] = { ...(existing as Record<string, t.ConfigValue>) };
      } else if (existing == null) {
        parent[seg] = {};
      } else {
        bailed = true;
        break;
      }
      parent = parent[seg] as Record<string, t.ConfigValue>;
    }
    if (bailed) continue;
    const lastSeg = arrayPath[arrayPath.length - 1];
    const arr = Array.isArray(parent[lastSeg]) ? [...(parent[lastSeg] as t.ConfigValue[])] : [];
    arr[index] = value;
    parent[lastSeg] = arr;
  }
  return merged;
}
