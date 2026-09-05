import type * as t from '@/types';
import { stripArrayIndices, PREVIOUS_IDENTITY_HINT_KEY } from './secrets';

const EMPTY_PATH_SET: ReadonlySet<string> = new Set();

const MCP_SERVER_HEADERS_PATH_RE = /^mcpServers\.[^.]+\.(?:headers|oauth_headers)$/;

/**
 * True only for the exact `mcpServers.<name>.headers`/`.oauth_headers` shape
 * the rename/create `__previousIdentity` hint actually rides on (see
 * `withPreviousIdentityHint`) — must match the backend's own
 * `isMcpServerHeadersContainerPath` in `secrets.ts`. A real header named
 * `__previousIdentity` anywhere else (a plain endpoint's `headers`, an array
 * entry's, `addParams`, ...) has no hint protocol to collide with, so it must
 * serialize like any other key rather than being dropped.
 */
export function isMcpServerHeadersContainerPath(fieldPath: string): boolean {
  return MCP_SERVER_HEADERS_PATH_RE.test(stripArrayIndices(fieldPath));
}

/**
 * Convert a KeyValuePair[] to a Record with typed values.
 * Returns the original value unchanged if it's not a KV pairs array.
 * `fieldPath`, when it resolves to an mcpServers headers/oauth_headers
 * container, additionally drops a row literally keyed `__previousIdentity`
 * — see `isMcpServerHeadersContainerPath`.
 */
export function serializeKVPairs(value: t.ConfigValue, fieldPath?: string): t.ConfigValue {
  if (!Array.isArray(value) || value.length === 0) return value;
  const first = value[0];
  if (typeof first !== 'object' || first === null || !('key' in first) || !('value' in first))
    return value;
  const pairs = value as t.KeyValuePair[];
  const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  if (fieldPath != null && isMcpServerHeadersContainerPath(fieldPath)) {
    DANGEROUS_KEYS.add(PREVIOUS_IDENTITY_HINT_KEY);
  }
  const record: Record<string, t.ConfigValue> = Object.create(null);
  for (const pair of pairs) {
    if (!pair.key || DANGEROUS_KEYS.has(pair.key)) continue;
    record[pair.key] = coerceKVValue(pair.value, pair.valueType ?? 'string');
  }
  return record;
}

/**
 * Recursively serialize KV pairs within an object tree. `KeyValueField`
 * always represents its value as an array, even once emptied by removing
 * the last row — `serializeKVPairs` alone can't tell that apart from any
 * other empty array, since there's no KV-shaped item left to inspect. Once
 * `basePath`/`recordFieldPaths` are supplied, an empty array found at a
 * path the schema registers as a `record` field serializes to `{}` instead
 * of staying `[]`, which a record-typed field's validation would otherwise
 * reject on save.
 */
export function deepSerializeKVPairs(
  value: t.ConfigValue,
  basePath = '',
  recordFieldPaths: ReadonlySet<string> = EMPTY_PATH_SET,
): t.ConfigValue {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return matchesRecordFieldPath(basePath, recordFieldPaths) ? {} : value;
    }
    const serialized = serializeKVPairs(value, basePath);
    if (serialized !== value) return serialized;
    return value.map((item, index) =>
      deepSerializeKVPairs(
        item,
        basePath ? `${basePath}.${index}` : String(index),
        recordFieldPaths,
      ),
    );
  }
  const obj = value as Record<string, t.ConfigValue>;
  const result: Record<string, t.ConfigValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = deepSerializeKVPairs(v, basePath ? `${basePath}.${k}` : k, recordFieldPaths);
  }
  return result;
}

/**
 * Schema paths of every `record`-typed field, so an emptied `KeyValueField`
 * at that path can be told apart from an unrelated empty array (see
 * `deepSerializeKVPairs`). Numeric array indices (`[]`) are stripped since
 * `stripArrayIndices` strips them the same way from a runtime path, but a
 * dynamic-key record segment (`{}`, e.g. `mcpServers.{}.headers`) is kept as
 * a literal wildcard token: the real runtime segment is an admin-chosen name
 * (`mcpServers.Jira`), not a number, so it can't be normalized away up
 * front — `matchesRecordFieldPath` matches it segment-by-segment instead.
 */
export function collectRecordFieldPaths(fields: t.SchemaField[]): Set<string> {
  const paths = new Set<string>();
  collectRecordFieldPathsRecursive(fields, paths);
  return paths;
}

function collectRecordFieldPathsRecursive(fields: t.SchemaField[], paths: Set<string>): void {
  for (const field of fields) {
    if (field.type === 'record') {
      paths.add(field.path.replace(/\.\[\]/g, ''));
    }
    if (field.children?.length) {
      collectRecordFieldPathsRecursive(field.children, paths);
    }
  }
}

function pathSegmentsMatchPattern(pathSegments: string[], patternSegments: string[]): boolean {
  if (pathSegments.length !== patternSegments.length) return false;
  for (let i = 0; i < patternSegments.length; i++) {
    if (patternSegments[i] !== '{}' && patternSegments[i] !== pathSegments[i]) return false;
  }
  return true;
}

/**
 * Whether `path` is registered as a `record`-typed field path, matching a
 * `{}` pattern segment (e.g. `mcpServers.{}.headers`) against any single
 * dynamic-key segment of `path` (e.g. `mcpServers.Jira.headers`).
 */
function matchesRecordFieldPath(path: string, patterns: ReadonlySet<string>): boolean {
  const strippedPath = stripArrayIndices(path);
  if (patterns.has(path) || patterns.has(strippedPath)) return true;
  const pathSegments = strippedPath.split('.');
  for (const pattern of patterns) {
    if (pattern.includes('{}') && pathSegmentsMatchPattern(pathSegments, pattern.split('.'))) {
      return true;
    }
  }
  return false;
}

function coerceKVValue(raw: string, type: t.KVValueType): t.ConfigValue {
  if (type === 'boolean') return raw === 'true';
  if (type === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (type === 'json') {
    try {
      return JSON.parse(raw) as t.ConfigValue;
    } catch {
      return raw;
    }
  }
  return raw;
}

export function formatJson(value: t.ConfigValue): string {
  if (value === undefined || value === null) return '';
  return JSON.stringify(value, null, 2);
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0]?.[0] ?? '').toUpperCase();
}

/**
 * Recursively flattens a nested object into dot-separated paths.
 * Plain objects become prefixes; arrays, primitives, and null become leaf entries.
 * e.g. { balance: { startBalance: 100 } } → { 'balance.startBalance': 100 }
 */
export function flattenObject(obj: Record<string, t.ConfigValue>, prefix = ''): t.FlatConfigMap {
  const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const result: t.FlatConfigMap = Object.create(null);
  for (const [key, value] of Object.entries(obj)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length > 0
    ) {
      Object.assign(result, flattenObject(value as Record<string, t.ConfigValue>, path));
    } else {
      result[path] = value;
    }
  }
  return result;
}

/**
 * Inverse of flattenObject: expands dot-separated paths back into a nested object.
 * e.g. { 'balance.startBalance': 100 } → { balance: { startBalance: 100 } }
 */
export function unflattenObject(flat: t.FlatConfigMap): Record<string, t.ConfigValue> {
  const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const result: Record<string, t.ConfigValue> = {};
  for (const [path, value] of Object.entries(flat)) {
    const keys = path.split('.');
    if (keys.some((k) => DANGEROUS_KEYS.has(k))) continue;
    let current = result as Record<string, t.ConfigValue>;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      const next = current[key];
      if (next === undefined || next === null || typeof next !== 'object' || Array.isArray(next)) {
        current[key] = {};
      }
      current = current[key] as Record<string, t.ConfigValue>;
    }
    current[keys[keys.length - 1]] = value;
  }
  return result;
}
