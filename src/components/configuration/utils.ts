import { replaceEqualDeep } from '@tanstack/react-query';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type * as t from '@/types';
import {
  deepSerializeKVPairs,
  isSecretRecordContainerPath,
  secretPathForPreviewPath,
  stripSecretPreviewValues,
  unflattenObject,
  withPreviousIdentityHint,
  PREVIOUS_IDENTITY_HINT_KEY,
} from '@/utils';

const INDEXED_ARRAY_PATH_RE = /^(.+)\.(\d+)$/;
/**
 * Matches the server-name segment of an `mcpServers.<name>` path, whether
 * `<name>` is the whole touched path (`mcpServers.A`) or a prefix of a
 * deeper one (`mcpServers.A.oauth`). Legacy dotted server names never
 * reach `detectStaleContainerEdits`'s grouping step at all — they're
 * rendered read-only with no rename/remove affordances, so they never
 * appear in `touchedPaths` — so capturing only up to the first dot is safe.
 */
const MCP_SERVER_NAME_RE = /^mcpServers\.([^.]+)(?:\.|$)/;

function isConfigObject(value: t.ConfigValue): value is Record<string, t.ConfigValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isOlderVersion<T>(
  current: T,
  candidate: T,
  getVersion: (value: T) => number | null | undefined,
  getScope?: (value: T) => string | undefined,
): boolean {
  if (getScope && getScope(current) !== getScope(candidate)) {
    return false;
  }
  const currentVersion = getVersion(current);
  const candidateVersion = getVersion(candidate);
  return currentVersion != null && (candidateVersion == null || candidateVersion < currentVersion);
}

/** Prevents React Query's own fetch completion from replacing a newer cached
 * snapshot with an older version that happened to resolve later. */
export function versionedStructuralSharing<T>(
  getVersion: (value: T) => number | null | undefined,
  getScope?: (value: T) => string | undefined,
): (oldData: unknown | undefined, newData: unknown) => unknown {
  return (oldData, newData) => {
    if (oldData == null) {
      return newData;
    }
    const current = oldData as T;
    const candidate = newData as T;
    if (isOlderVersion(current, candidate, getVersion, getScope)) {
      return oldData;
    }
    return replaceEqualDeep(oldData, newData);
  };
}

/**
 * Installs `fresh` into the query cache at `queryKey`, but only if its
 * version is not older than whatever is already cached there — and returns
 * whichever value actually "won", so the caller's own local state can stay
 * consistent with the cache instead of freezing against a value it just
 * discarded.
 *
 * `ConfigPage`'s own rebase/discard and `LangfuseRenderer`'s post-mutation
 * refresh both read the same `baseConfigOptions` key directly (bypassing
 * React Query's request tracking specifically so neither joins a stale
 * in-flight fetch — see the callers), which means they can race with each
 * other outside any single request's lifecycle: `queryClient.cancelQueries`
 * only fences a fetch React Query itself is tracking, not a second, wholly
 * separate direct call from another component. Comparing versions here is
 * what actually closes that gap — whichever read resolves last no longer
 * matters, only whichever carries the highest version does.
 *
 * A numeric version always outranks `null`/`undefined`: for both call sites
 * today, a null version means "no document has ever existed yet." Once a
 * document is created, a late-arriving pre-creation read must never regress
 * the cache back to that state — so `null` only wins when there's no numeric
 * version on either side to compare against.
 */
export function installIfNewer<T>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  fresh: T,
  getVersion: (value: T) => number | null | undefined,
  getScope?: (value: T) => string | undefined,
): T {
  const current = queryClient.getQueryData<T>(queryKey);
  if (current == null) {
    queryClient.setQueryData(queryKey, fresh);
    return fresh;
  }
  if (isOlderVersion(current, fresh, getVersion, getScope)) {
    return current;
  }
  queryClient.setQueryData(queryKey, fresh);
  return fresh;
}

/**
 * Builds the save payload from touched edits. Only admin-touched paths are
 * submitted, secret display companion paths are dropped, and display
 * companion strings nested inside object values are stripped — a masked
 * display value (`sk-mist...4321`) must never reach the backend as a value.
 * `recordFieldPaths` lets an emptied `KeyValueField` (a record-typed field
 * with its last row removed) serialize to `{}` instead of staying `[]` —
 * see `deepSerializeKVPairs`'s doc comment.
 */
export function buildSavePayload(
  touchedPaths: ReadonlySet<string>,
  editedValues: t.FlatConfigMap,
  schemaPaths: ReadonlySet<string>,
  recordFieldPaths: ReadonlySet<string>,
): t.SavePayload {
  const touched = [...touchedPaths].filter((p) => p in editedValues);
  const saves = touched
    .filter(
      (p) => editedValues[p] !== undefined && secretPathForPreviewPath(p, schemaPaths) == null,
    )
    .map((p) => ({
      fieldPath: p,
      value: stripSecretPreviewValues(
        deepSerializeKVPairs(editedValues[p], p, recordFieldPaths),
        p,
        schemaPaths,
      ),
    }));
  const resets = touched.filter((p) => editedValues[p] === undefined);
  const recreated = new Map<string, t.FlatConfigMap>();
  for (const reset of resets) {
    if (/^mcpServers\.[^.]+$/.test(reset)) {
      recreated.set(reset, {});
    }
  }
  const normalizedSaves = saves.filter(({ fieldPath, value }) => {
    const entryPath = fieldPath.split('.').slice(0, 2).join('.');
    const fields = recreated.get(entryPath);
    if (!fields || fieldPath === entryPath) return true;
    fields[fieldPath.slice(entryPath.length + 1)] = value;
    return false;
  });
  const replaced = new Set<string>();
  for (const [entryPath, fields] of recreated) {
    if (Object.keys(fields).length === 0) continue;
    const entry = unflattenObject(fields);
    const secretKeys = ['oauth', 'apiKey', 'headers', 'oauth_headers'] as const;
    const origin =
      secretKeys
        .map((key) => entry[key])
        .filter(isConfigObject)
        .map((value) => value[PREVIOUS_IDENTITY_HINT_KEY])
        .find((value) => typeof value === 'string') ?? null;
    /** A recreated name must not inherit the deleted server's credentials.
     * Explicit empty record containers suppress omitted-header preservation;
     * keep any rename origin supplied by the renderer for moved credentials. */
    for (const key of secretKeys) {
      const value = entry[key] ?? (key === 'headers' || key === 'oauth_headers' ? {} : undefined);
      if (isConfigObject(value)) {
        entry[key] = withPreviousIdentityHint(
          value,
          PREVIOUS_IDENTITY_HINT_KEY in value ? undefined : origin,
        );
      }
    }
    normalizedSaves.push({ fieldPath: entryPath, value: entry });
    replaced.add(entryPath);
  }
  return {
    touched,
    saves: normalizedSaves,
    resets: resets.filter((path) => !replaced.has(path.split('.').slice(0, 2).join('.'))),
  };
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

/** Include the dedicated Langfuse connection in generic configured-state UI. */
export function withLangfuseConfiguredPath(
  configuredPaths: Set<string>,
  configured: boolean,
): Set<string> {
  const paths = new Set(configuredPaths);
  if (configured) paths.add('langfuse.enabled');
  return paths;
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

/** MCP entry recreation has an explicit payload encoding; other ancestor resets
 * must be saved or discarded before descendants can be edited. */
export function getBlockingConfigReset(edits: t.FlatConfigMap, path: string): string | undefined {
  return Object.keys(edits).find(
    (reset) =>
      edits[reset] === undefined &&
      path.startsWith(`${reset}.`) &&
      !/^mcpServers\.[^.]+$/.test(reset),
  );
}

export function applyConfigEdit(
  prev: t.FlatConfigMap,
  path: string,
  value: t.ConfigValue,
  baseline: t.FlatConfigMap,
  baselineIntermediates: Set<string>,
  baselineContainerPaths: Set<string>,
  allowResetOverlap = false,
): t.FlatConfigMap {
  if (!allowResetOverlap && getBlockingConfigReset(prev, path)) return prev;
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

/** An explicit reset supersedes pending edits beneath it. Unlike reverting an
 * edit to the baseline, a reset must survive even when the baseline is absent
 * or redacted (notably for secrets). */
export function applyConfigReset(prev: t.FlatConfigMap, path: string): t.FlatConfigMap {
  const next = { ...prev, [path]: undefined };
  for (const existing of Object.keys(next)) {
    if (existing.startsWith(`${path}.`)) {
      delete next[existing];
    } else if (path.startsWith(`${existing}.`)) {
      if (next[existing] === undefined) {
        // An existing ancestor reset already covers this reset.
        delete next[path];
      } else {
        delete next[existing];
      }
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

function deepEqualConfigValue(a: t.ConfigValue, b: t.ConfigValue): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function isPlainObjectValue(value: t.ConfigValue): value is Record<string, t.ConfigValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Whether any leaf beneath `path` (or `path` itself, for an empty object) differs
 * between the two flattened baselines. `flattenObject` never emits a flat entry for
 * a non-empty plain object's own path — only for its leaves — so a whole-record
 * draft's container can't be compared directly the way a whole-array draft's can.
 */
function objectDescendantsChanged(
  path: string,
  oldBaseline: t.FlatConfigMap,
  newBaseline: t.FlatConfigMap,
): boolean {
  const prefix = `${path}.`;
  const isRelevant = (key: string): boolean => key === path || key.startsWith(prefix);
  const keys = new Set<string>();
  for (const key of Object.keys(oldBaseline)) {
    if (isRelevant(key)) keys.add(key);
  }
  for (const key of Object.keys(newBaseline)) {
    if (isRelevant(key)) keys.add(key);
  }
  for (const key of keys) {
    if (!deepEqualConfigValue(oldBaseline[key], newBaseline[key])) {
      return true;
    }
  }
  return false;
}

/**
 * Whether `path` has at least one leaf strictly beneath it (not `path` itself)
 * in either baseline — the signal that it currently is, or previously was, a
 * record-type container rather than a scalar. `flattenObject` never emits a
 * flat entry for a non-empty record's own path (see `objectDescendantsChanged`
 * above), so a bare presence/absence check on `path` itself can't tell a
 * record apart from a scalar; a genuine descendant can.
 */
function hasRecordDescendants(
  path: string,
  oldBaseline: t.FlatConfigMap,
  newBaseline: t.FlatConfigMap,
): boolean {
  const prefix = `${path}.`;
  for (const key of Object.keys(oldBaseline)) {
    if (key.startsWith(prefix)) return true;
  }
  for (const key of Object.keys(newBaseline)) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Whether `mcpServers.<name>`'s entry, or any leaf beneath it, is present in
 * `baseline` — the signal that this server name already existed before the
 * edit session started, as opposed to being created or renamed into
 * existence during it. Mirrors `hasRecordDescendants`'s prefix scan (see
 * above) against the fixed `mcpServers.<name>` entry path, plus an exact
 * match for the empty-object case that scan alone can't see.
 */
function mcpServerExistedInBaseline(name: string, baseline: t.FlatConfigMap): boolean {
  const entryPath = `mcpServers.${name}`;
  const prefix = `${entryPath}.`;
  for (const key of Object.keys(baseline)) {
    if (key === entryPath || key.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Whether `path` is, or has anywhere beneath it, a registered secret leaf or
 * secret-record container (`headers`, `env`, …). A redacted read *deletes*
 * hidden credential values rather than masking them, so a concurrent change
 * to ONLY a hidden credential inside a container produces identical
 * flattened old/new baselines — invisible to `objectDescendantsChanged`
 * and `deepEqualConfigValue` below, no matter how thoroughly they compare.
 * `mcpServers` entries are always treated as secret-bearing regardless of
 * schema-registered paths: their credential sub-paths (`oauth.client_secret`,
 * `apiKey.key`, `headers`, `oauth_headers`) are keyed by an admin-chosen
 * server name, which `secretFieldPaths` — derived from the static schema —
 * cannot express.
 */
function isSecretBearingContainerPath(
  path: string,
  secretFieldPaths: ReadonlySet<string>,
): boolean {
  if (path === 'mcpServers' || path.startsWith('mcpServers.')) {
    return true;
  }
  if (isSecretRecordContainerPath(path, secretFieldPaths)) {
    return true;
  }
  const prefix = `${path}.`;
  for (const registered of secretFieldPaths) {
    if (registered === path || registered.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

/**
 * After a version-conflict rebase, a whole-container edit's premise can be
 * invalidated by what changed underneath it between the old and new baseline:
 *
 * - An indexed edit (`endpoints.custom.0`) targets an item by position. If the
 *   array's contents at that position changed (a reorder, a deletion, another
 *   admin's edit, ...), reapplying by index alone would silently modify whichever
 *   item now happens to sit there instead.
 * - A whole-array edit (`endpoints.custom` holding a complete array, submitted by
 *   `ArrayObjectField`'s add/remove) was computed by the admin's browser from the
 *   *old* array. If the array itself changed underneath it, replaying that
 *   precomputed array would silently overwrite the other admin's change to it.
 * - A whole-record edit (a plain object, submitted by `RecordObjectField`'s
 *   add/remove/rename/entry-change) was likewise computed from the *old* record.
 *   If any key in the record changed underneath it — including a DIFFERENT key
 *   than the one the admin touched — replaying the precomputed record would
 *   silently overwrite that other admin's change to it.
 * - A reset (`editedValues[path] === undefined`, deleting the override) carries
 *   no value to inspect, so its container kind — and therefore whether it needs
 *   this check at all — has to be inferred from the baselines instead: an array
 *   container gets the same whole-array comparison, a record container gets the
 *   same descendant comparison, and a scalar reset is left alone entirely, since
 *   deleting one layer's override is well-defined and safe regardless of what
 *   changed underneath (it only reveals whatever the next layer says now).
 *
 * A secret-bearing container (see `isSecretBearingContainerPath`) is ALWAYS
 * treated as stale on top of the structural checks above, regardless of what
 * either comparison finds — a concurrent change to only a hidden credential
 * is invisible to both, so the safe default is to drop the operation and ask
 * the admin to redo it against the new baseline rather than risk silently
 * erasing the other admin's credential change.
 *
 * Returns the subset of `touchedPaths` that must be dropped rather than blindly
 * reapplied; the caller is expected to remove them from the draft and tell the
 * admin to redo them against the new baseline.
 */
export function detectStaleContainerEdits(
  touchedPaths: ReadonlySet<string>,
  editedValues: t.FlatConfigMap,
  oldBaseline: t.FlatConfigMap,
  newBaseline: t.FlatConfigMap,
  secretFieldPaths: ReadonlySet<string>,
): string[] {
  const stale: string[] = [];
  for (const path of touchedPaths) {
    const match = INDEXED_ARRAY_PATH_RE.exec(path);
    if (match) {
      const [, arrayPath, indexStr] = match;
      const index = Number(indexStr);
      const oldArray = oldBaseline[arrayPath];
      const newArray = newBaseline[arrayPath];
      const oldItem = Array.isArray(oldArray) ? oldArray[index] : undefined;
      const newItem = Array.isArray(newArray) ? newArray[index] : undefined;
      if (
        isSecretBearingContainerPath(arrayPath, secretFieldPaths) ||
        !deepEqualConfigValue(oldItem as t.ConfigValue, newItem as t.ConfigValue)
      ) {
        stale.push(path);
      }
      continue;
    }

    const draftValue = editedValues[path];
    if (draftValue === undefined) {
      if (Array.isArray(oldBaseline[path]) || Array.isArray(newBaseline[path])) {
        if (
          isSecretBearingContainerPath(path, secretFieldPaths) ||
          !deepEqualConfigValue(oldBaseline[path], newBaseline[path])
        ) {
          stale.push(path);
        }
        continue;
      }
      if (isSecretBearingContainerPath(path, secretFieldPaths)) {
        stale.push(path);
        continue;
      }
      if (
        hasRecordDescendants(path, oldBaseline, newBaseline) &&
        objectDescendantsChanged(path, oldBaseline, newBaseline)
      ) {
        stale.push(path);
      }
      continue;
    }
    if (Array.isArray(draftValue)) {
      if (
        isSecretBearingContainerPath(path, secretFieldPaths) ||
        !deepEqualConfigValue(oldBaseline[path], newBaseline[path])
      ) {
        stale.push(path);
      }
      continue;
    }
    if (
      isPlainObjectValue(draftValue) &&
      (isSecretBearingContainerPath(path, secretFieldPaths) ||
        objectDescendantsChanged(path, oldBaseline, newBaseline))
    ) {
      stale.push(path);
    }
  }

  // An MCP server rename/create is submitted as several INDEPENDENT touched
  // paths — destination secret sub-objects, destination scalar leaves,
  // source leaf resets, source entry reset — rather than one atomic
  // operation. A destination's oauth/apiKey/headers/oauth_headers sub-object
  // write and a source entry's reset both reach the secret-bearing checks
  // above and get dropped, but a destination's plain scalar leaf write
  // (`mcpServers.B.url`, a string, never a container) structurally never
  // enters any branch above — `detectStaleContainerEdits` only looks at
  // container-shaped operations. Left alone, that asymmetry produces an
  // inconsistent draft after a rebase: an uncredentialed "B" (its secrets
  // dropped, its other fields kept) and/or a still-present "A" (only some of
  // its cleanup resets dropped). Once any path for a given server name is
  // stale, every other touched path for that SAME name is dropped too, so
  // the whole logical create/rename is kept or dropped as one unit.
  const staleMcpServerNames = new Set<string>();
  for (const path of stale) {
    const match = MCP_SERVER_NAME_RE.exec(path);
    if (match) {
      staleMcpServerNames.add(match[1]);
    }
  }

  // A rename whose destination has no oauth/apiKey/headers/oauth_headers at
  // all — only scalar leaves like `url`/`type` — never lands a single path
  // in `stale` on its own (see the branches above), so the propagation just
  // above has nothing to propagate from and the destination is silently
  // treated as safe to reapply. A name that didn't exist in the pre-edit
  // baseline, appearing in the same session as some OTHER entry vanishing
  // entirely, is the fingerprint of a rename (one name disappears, another
  // appears) — seed it in too. The flat edit model carries no explicit
  // source/destination link, so this can't prove the two are the SAME
  // rename; it also sweeps in a same-session new create that happens to
  // coincide with an unrelated deletion elsewhere. That's the accepted
  // trade-off over silently keeping a rename destination's scalar leaves —
  // a brand-new name with no entry vanishing anywhere in the session is
  // left alone (see "does not drop an unrelated MCP server..." below).
  const hasVanishedMcpEntry = [...touchedPaths].some(
    (path) => isMcpEntryPath(path) && editedValues[path] === undefined,
  );
  if (hasVanishedMcpEntry) {
    for (const path of touchedPaths) {
      const match = MCP_SERVER_NAME_RE.exec(path);
      if (match && !mcpServerExistedInBaseline(match[1], oldBaseline)) {
        staleMcpServerNames.add(match[1]);
      }
    }
  }

  if (staleMcpServerNames.size > 0) {
    const staleSet = new Set(stale);
    for (const path of touchedPaths) {
      const match = MCP_SERVER_NAME_RE.exec(path);
      if (match && staleMcpServerNames.has(match[1]) && !staleSet.has(path)) {
        stale.push(path);
        staleSet.add(path);
      }
    }
  }

  return stale;
}
