import type * as t from '@/types';

const DISPLAY_KEY_RE = /^display([A-Z].*)$/;

function secretKeyForDisplayKey(key: string): string | null {
  const match = DISPLAY_KEY_RE.exec(key);
  if (!match) return null;
  return match[1].charAt(0).toLowerCase() + match[1].slice(1);
}

/** Display companion key for a secret field key (`apiKey` → `displayApiKey`). */
export function toSecretDisplayKey(key: string): string {
  return `display${key.charAt(0).toUpperCase()}${key.slice(1)}`;
}

/**
 * Masked display value (e.g. `sk-mist...4321`) for a redacted secret field,
 * read from the sibling display companion the backend returns when a secret
 * is set. Returns undefined when the field has no set-and-hidden secret.
 */
export function getSecretDisplayValue(parentValue: t.ConfigValue, key: string): string | undefined {
  if (!parentValue || typeof parentValue !== 'object' || Array.isArray(parentValue)) {
    return undefined;
  }
  const sibling = (parentValue as Record<string, t.ConfigValue>)[toSecretDisplayKey(key)];
  return typeof sibling === 'string' && sibling !== '' ? sibling : undefined;
}

/**
 * Real secret path for a display companion path (`ocr.displayApiKey` →
 * `ocr.apiKey`). Anchored to known schema leaf paths so dynamic record keys
 * that merely look display-shaped never match.
 */
export function secretPathForDisplayPath(
  path: string,
  schemaPaths: ReadonlySet<string>,
): string | null {
  const lastDot = path.lastIndexOf('.');
  const realKey = secretKeyForDisplayKey(lastDot === -1 ? path : path.slice(lastDot + 1));
  if (!realKey) return null;
  const realPath = lastDot === -1 ? realKey : `${path.slice(0, lastDot + 1)}${realKey}`;
  return schemaPaths.has(realPath) ? realPath : null;
}

/**
 * Replaces display companion paths with their real secret paths so a redacted
 * secret still counts as configured/overridden for indicator and reset logic.
 */
export function mapSecretDisplayPaths(
  paths: Iterable<string>,
  schemaPaths: ReadonlySet<string>,
): Set<string> {
  const result = new Set<string>();
  for (const path of paths) {
    result.add(secretPathForDisplayPath(path, schemaPaths) ?? path);
  }
  return result;
}

/**
 * Deep-removes display companion strings from a value before submission. The
 * backend rejects writes to display paths, and a masked display value must
 * never round-trip as if it were a real secret.
 */
export function stripSecretDisplayValues(
  value: t.ConfigValue,
  basePath: string,
  schemaPaths: ReadonlySet<string>,
): t.ConfigValue {
  if (Array.isArray(value)) {
    return value.map((entry) => stripSecretDisplayValues(entry, basePath, schemaPaths));
  }
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, t.ConfigValue> = {};
  for (const [key, child] of Object.entries(value as Record<string, t.ConfigValue>)) {
    const childPath = basePath ? `${basePath}.${key}` : key;
    if (typeof child === 'string' && secretPathForDisplayPath(childPath, schemaPaths) != null) {
      continue;
    }
    result[key] = stripSecretDisplayValues(child, childPath, schemaPaths);
  }
  return result;
}

/**
 * Drops schema fields that are display companions of a sibling secret field
 * (`displayApiKey` next to `apiKey`) so they never render as editable inputs.
 * Operates on a single field level; extraction applies it per level.
 */
export function filterSecretDisplayFields(fields: t.SchemaField[]): t.SchemaField[] {
  const keys = new Set(fields.map((f) => f.key));
  return fields.filter((field) => {
    if (field.type !== 'string') return true;
    const realKey = secretKeyForDisplayKey(field.key);
    return realKey == null || !keys.has(realKey);
  });
}
