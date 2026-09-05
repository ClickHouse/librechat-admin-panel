import type * as t from '@/types';

const PREVIEW_KEY_RE = /^(.+)Preview$/;
const ARRAY_INDEX_SEGMENT_RE = /\.\d+(?=\.|$)/g;

function secretKeyForPreviewKey(key: string): string | null {
  const match = PREVIEW_KEY_RE.exec(key);
  if (!match) return null;
  return match[1];
}

/**
 * Strips numeric array-index segments (`endpoints.custom.0.apiKey` →
 * `endpoints.custom.apiKey`) so an edited array entry's path matches the
 * schema's index-free field paths.
 */
export function stripArrayIndices(path: string): string {
  return path.replace(ARRAY_INDEX_SEGMENT_RE, '');
}

/** Masked-preview companion key for a secret field key (`apiKey` → `apiKeyPreview`). */
export function toSecretPreviewKey(key: string): string {
  return `${key}Preview`;
}

/**
 * Masked preview value (e.g. `sk-mist...4321`) for a redacted secret field,
 * read from the sibling preview companion the backend returns when a secret
 * is set. Returns undefined when the field has no set-and-hidden secret.
 */
export function getSecretPreviewValue(parentValue: t.ConfigValue, key: string): string | undefined {
  if (!parentValue || typeof parentValue !== 'object' || Array.isArray(parentValue)) {
    return undefined;
  }
  const sibling = (parentValue as Record<string, t.ConfigValue>)[toSecretPreviewKey(key)];
  return typeof sibling === 'string' && sibling !== '' ? sibling : undefined;
}

/**
 * Real secret path for a preview companion path (`ocr.apiKeyPreview` →
 * `ocr.apiKey`). Anchored to known schema leaf paths so dynamic record keys
 * that merely look preview-shaped never match.
 */
export function secretPathForPreviewPath(
  path: string,
  schemaPaths: ReadonlySet<string>,
): string | null {
  const lastDot = path.lastIndexOf('.');
  const realKey = secretKeyForPreviewKey(lastDot === -1 ? path : path.slice(lastDot + 1));
  if (!realKey) return null;
  const realPath = lastDot === -1 ? realKey : `${path.slice(0, lastDot + 1)}${realKey}`;
  return schemaPaths.has(stripArrayIndices(realPath)) ? realPath : null;
}

/**
 * Replaces preview companion paths with their real secret paths so a redacted
 * secret still counts as configured/overridden for indicator and reset logic.
 */
export function mapSecretPreviewPaths(
  paths: Iterable<string>,
  schemaPaths: ReadonlySet<string>,
): Set<string> {
  const result = new Set<string>();
  for (const path of paths) {
    result.add(secretPathForPreviewPath(path, schemaPaths) ?? path);
  }
  return result;
}

/**
 * Deep-removes preview companion strings from a value before submission. The
 * backend rejects writes to preview paths, and a masked preview value must
 * never round-trip as if it were a real secret.
 */
export function stripSecretPreviewValues(
  value: t.ConfigValue,
  basePath: string,
  schemaPaths: ReadonlySet<string>,
): t.ConfigValue {
  if (Array.isArray(value)) {
    return value.map((entry) => stripSecretPreviewValues(entry, basePath, schemaPaths));
  }
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, t.ConfigValue> = {};
  for (const [key, child] of Object.entries(value as Record<string, t.ConfigValue>)) {
    const childPath = basePath ? `${basePath}.${key}` : key;
    if (typeof child === 'string' && secretPathForPreviewPath(childPath, schemaPaths) != null) {
      continue;
    }
    result[key] = stripSecretPreviewValues(child, childPath, schemaPaths);
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

const ENCRYPTED_SECRET_RE = /^v3:[0-9a-f]{32}:[0-9a-f]+$/;

/**
 * Whether a stored value is backend ciphertext.
 *
 * The API rejects submitted encrypted values, so a snapshot secret in this
 * shape is omitted from the outgoing payload rather than echoed back. The
 * backend re-attaches it inside the mutation transaction, matching entries by
 * their stable identity — which is also the only place that can do it without
 * a decrypt/re-encrypt round trip through the browser.
 */
export function isEncryptedSecretValue(value: unknown): boolean {
  return typeof value === 'string' && ENCRYPTED_SECRET_RE.test(value.trim());
}

const SECRET_LEAF_KEY_RE = /^(apiKey|secretKey|client_secret|.*ApiKey)$/;
/** Primitive string records that commonly carry literal credentials. */
const SECRET_RECORD_KEYS = new Set(['headers', 'oauth_headers', 'additionalHeaders', 'env']);

/**
 * Hidden field an array entry (`endpoints.custom[]`, `endpoints.azureOpenAI.groups[]`)
 * carries alongside its visible identity (`name`/`group`) so the backend can
 * restore encrypted credentials by stable identity across a rename, which an
 * exact-identity match alone can't do once the identity itself has changed.
 *
 * Three distinct wire states, all meaningful to the backend's matching:
 * - key absent entirely: no signal — an old/non-upgraded client, or an
 *   untouched sibling entry the panel's own merge layer resubmitted as-is.
 *   Falls back to bare-identity matching, exactly like the pre-hint behavior.
 * - `null`: an explicit "this entry has no origin" — stamped at creation
 *   (`ArrayObjectField`'s add, `CreateCustomEndpointDialog`'s create) so a
 *   brand-new entry can never inherit another entry's credentials merely by
 *   reusing a name freed up by a delete elsewhere in the same submission.
 * - a non-empty string: the entry's identity before the rename that produced
 *   its current one.
 *
 * Must match `PREVIOUS_IDENTITY_HINT_KEY` in the backend's `secrets.ts`.
 */
export const PREVIOUS_IDENTITY_HINT_KEY = '__previousIdentity';

/**
 * Attaches (or clears) the rename-origin hint on an array entry's value.
 * `origin === undefined` leaves the value untouched (no hint tracked yet, or
 * this array doesn't use identity tracking); `null` stamps the explicit
 * "no origin" marker; a string stamps the entry's real previous identity.
 */
export function withPreviousIdentityHint(
  value: t.ConfigValue,
  origin: string | null | undefined,
): t.ConfigValue {
  if (origin === undefined || typeof value !== 'object' || value === null || Array.isArray(value)) {
    return value;
  }
  return { ...value, [PREVIOUS_IDENTITY_HINT_KEY]: origin };
}

/**
 * Whether `path` is a registered secret leaf or matches a wildcard pattern
 * such as `endpoints.custom.headers.*`.
 *
 * Array indexes are recognized only between schema container segments so
 * numeric and dotted credential-record keys (header `"123"`, `"X.Foo"`)
 * remain part of the secret key rather than being treated as path structure.
 */
export function isSecretFieldPath(path: string, secretFieldPaths: ReadonlySet<string>): boolean {
  if (secretFieldPaths.has(path) || secretFieldPaths.has(stripArrayIndices(path))) {
    return true;
  }

  for (const registered of secretFieldPaths) {
    if (!registered.endsWith('.*')) continue;
    if (isUnderSecretContainer(path, registered.slice(0, -2))) {
      return true;
    }
  }
  return false;
}

const ARRAY_INDEX_KEY_RE = /^\d+$/;

/** True when `path` is a value under `container`, allowing `.N` indexes between schema segments. */
function isUnderSecretContainer(path: string, container: string): boolean {
  const containerParts = container.split('.');
  const pathParts = path.split('.');
  let i = 0;
  for (let c = 0; c < containerParts.length; c++) {
    if (i >= pathParts.length || pathParts[i] !== containerParts[c]) {
      return false;
    }
    i += 1;
    if (
      c < containerParts.length - 1 &&
      i < pathParts.length &&
      ARRAY_INDEX_KEY_RE.test(pathParts[i])
    ) {
      i += 1;
    }
  }
  return i < pathParts.length;
}

/** Whether `field` is a schema-registered credential-record container (`headers`, `env`, …). */
export function isSecretRecordSchemaField(field: t.SchemaField): boolean {
  return (
    field.type === 'record' &&
    field.recordValueType === 'primitive' &&
    SECRET_RECORD_KEYS.has(field.key)
  );
}

/**
 * Drops redacted credential-record containers (`headers`, `env`, …) left as an
 * empty/placeholder object on an entry that wasn't itself the one being edited.
 *
 * A redacted read leaves these containers present rather than omitted, so any
 * structural collection operation that copies an entry forward verbatim (array
 * add/remove, endpoint creation) would otherwise resubmit the placeholder as if
 * the admin had deliberately cleared it, erasing the real secret on save.
 * `ObjectEntryCard` applies the same rule for direct field edits; this is the
 * shared version for callers that rewrite a whole collection at once. A
 * container the admin actually edited is left alone — `KeyValueField` always
 * produces an array, never a plain object, so the `!Array.isArray` check below
 * distinguishes an untouched placeholder from a real (even emptied) edit.
 */
export function stripUntouchedSecretRecordContainers(
  entry: t.ConfigValue,
  fields: t.SchemaField[],
): t.ConfigValue {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return entry;
  }
  let next = entry as Record<string, t.ConfigValue>;
  for (const field of fields) {
    if (!isSecretRecordSchemaField(field)) continue;
    const containerValue = next[field.key];
    if (typeof containerValue === 'object' && containerValue !== null && !Array.isArray(containerValue)) {
      if (next === entry) {
        next = { ...next };
      }
      delete next[field.key];
    }
  }
  return next;
}

/** Collects index-free secret leaf paths and `record.*` wildcards from a schema tree. */
export function collectSecretFieldPaths(fields: t.SchemaField[]): Set<string> {
  const secretPaths = new Set<string>();
  collectSecretFieldPathsRecursive(fields, secretPaths);
  return secretPaths;
}

function collectSecretFieldPathsRecursive(fields: t.SchemaField[], secretPaths: Set<string>): void {
  for (const field of fields) {
    const path = field.path.replace(/\.(\[\]|\{\})/g, '');
    if (field.type === 'string' && SECRET_LEAF_KEY_RE.test(field.key)) {
      secretPaths.add(path);
    }
    if (isSecretRecordSchemaField(field)) {
      secretPaths.add(`${path}.*`);
    }
    if (field.children?.length) {
      collectSecretFieldPathsRecursive(field.children, secretPaths);
    }
  }
}

/**
 * Whether `path` is a registered credential-record container
 * (`endpoints.custom.headers` when `endpoints.custom.headers.*` is registered).
 */
export function isSecretRecordContainerPath(
  path: string,
  secretFieldPaths: ReadonlySet<string>,
): boolean {
  return secretFieldPaths.has(`${path}.*`) || secretFieldPaths.has(`${stripArrayIndices(path)}.*`);
}

/**
 * Restores schema secret fields omitted by the UI (which sends `apiKeyPreview`
 * instead of `apiKey`). An explicitly supplied real secret, including `''`,
 * replaces the snapshot value.
 *
 * Credential-record containers (`headers`, `env`, …) that are present on the
 * edited object are authoritative — including `{}` or a partial map — so
 * omitted keys are treated as intentional deletes. The entire snapshot record
 * is restored only when that container key itself is absent.
 */
export function mergeUntouchedSecrets(
  edited: unknown,
  snapshot: unknown,
  parentPath: string,
  secretFieldPaths: ReadonlySet<string>,
): unknown {
  if (!isPlainObject(edited) || !isPlainObject(snapshot)) {
    return edited;
  }
  const parentIsSecretContainer = isSecretRecordContainerPath(parentPath, secretFieldPaths);
  const result: Record<string, unknown> = { ...edited };
  for (const [key, snapshotVal] of Object.entries(snapshot)) {
    if (parentIsSecretContainer) {
      if (!Object.hasOwn(result, key) && !isEncryptedSecretValue(snapshotVal)) {
        result[key] = snapshotVal;
      }
      continue;
    }
    const fieldPath = parentPath ? `${parentPath}.${key}` : key;
    if (isSecretFieldPath(fieldPath, secretFieldPaths)) {
      if (!Object.hasOwn(result, key) && !isEncryptedSecretValue(snapshotVal)) {
        result[key] = snapshotVal;
      }
      continue;
    }
    if (isPlainObject(snapshotVal)) {
      if (Object.hasOwn(result, key) && isPlainObject(result[key])) {
        if (isSecretRecordContainerPath(fieldPath, secretFieldPaths)) {
          continue;
        }
        result[key] = mergeUntouchedSecrets(result[key], snapshotVal, fieldPath, secretFieldPaths);
        continue;
      }
      if (!Object.hasOwn(result, key)) {
        const merged = mergeUntouchedSecrets({}, snapshotVal, fieldPath, secretFieldPaths);
        if (isPlainObject(merged) && Object.keys(merged).length > 0) {
          result[key] = merged;
        }
      }
    }
  }
  return result;
}

/**
 * Restores one secret key from the Mongo snapshot onto an untouched entry.
 * A ciphertext snapshot value is dropped rather than echoed back: the backend
 * rejects submitted ciphertext and preserves the omitted secret itself.
 */
function restoreSnapshotSecret(
  result: Record<string, unknown>,
  snapshotEntry: unknown,
  key: string,
): void {
  if (!isPlainObject(snapshotEntry) || !Object.hasOwn(snapshotEntry, key)) {
    delete result[key];
    return;
  }
  if (isEncryptedSecretValue(snapshotEntry[key])) {
    delete result[key];
    return;
  }
  result[key] = snapshotEntry[key];
}

/**
 * For untouched array entries, keep only secret values present in the Mongo
 * snapshot. YAML/environment credentials must not materialize into Mongo.
 * Recurses into nested objects and wildcard credential records.
 */
export function retainSnapshotSecretsOnly(
  entry: unknown,
  snapshotEntry: unknown,
  parentPath: string,
  secretFieldPaths: ReadonlySet<string>,
): unknown {
  if (!isPlainObject(entry)) {
    return entry;
  }
  const parentIsSecretContainer = isSecretRecordContainerPath(parentPath, secretFieldPaths);
  const result: Record<string, unknown> = { ...entry };
  for (const key of Object.keys(result)) {
    if (parentIsSecretContainer) {
      restoreSnapshotSecret(result, snapshotEntry, key);
      continue;
    }
    const fieldPath = parentPath ? `${parentPath}.${key}` : key;
    if (isSecretFieldPath(fieldPath, secretFieldPaths)) {
      restoreSnapshotSecret(result, snapshotEntry, key);
      continue;
    }
    if (isPlainObject(result[key])) {
      const nestedSnapshot = isPlainObject(snapshotEntry) ? snapshotEntry[key] : undefined;
      const nested = retainSnapshotSecretsOnly(
        result[key],
        nestedSnapshot,
        fieldPath,
        secretFieldPaths,
      );
      if (isPlainObject(nested) && Object.keys(nested).length === 0) {
        delete result[key];
      } else {
        result[key] = nested;
      }
    }
  }
  return result;
}

/**
 * Drops schema fields that are preview companions of a sibling secret field
 * (`apiKeyPreview` next to `apiKey`) so they never render as editable inputs.
 * Operates on a single field level; extraction applies it per level.
 */
export function filterSecretPreviewFields(fields: t.SchemaField[]): t.SchemaField[] {
  const keys = new Set(fields.map((f) => f.key));
  return fields.filter((field) => {
    if (field.type !== 'string') return true;
    const realKey = secretKeyForPreviewKey(field.key);
    return realKey == null || !keys.has(realKey);
  });
}
