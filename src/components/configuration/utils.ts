import type * as t from '@/types';

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
