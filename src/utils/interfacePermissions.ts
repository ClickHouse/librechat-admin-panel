import {
  INTERFACE_PERMISSION_FIELDS,
  PERMISSION_SUB_KEYS,
} from 'librechat-data-provider';
import type { TInterfaceConfig } from 'librechat-data-provider';
import type * as t from '@/types';

export { INTERFACE_PERMISSION_FIELDS, PERMISSION_SUB_KEYS };

type InterfacePermissionUiNode = true | { readonly [key: string]: InterfacePermissionUiNode };

/**
 * UI-only paths allowed under each interface permission field, including nesting.
 * Fields omitted here (booleans and permission-only objects) reject every descendant.
 */
const INTERFACE_PERMISSION_UI_SHAPES: Readonly<Record<string, InterfacePermissionUiNode>> = {
  mcpServers: {
    placeholder: true,
    trustCheckbox: {
      label: true,
      subLabel: true,
    },
  },
  marketplace: {
    verification: true,
  },
  skills: {
    defaultActiveOnShare: true,
  },
  sharedLinks: {
    snapshotFiles: true,
  },
};

function isUiShapeMap(
  node: InterfacePermissionUiNode,
): node is { readonly [key: string]: InterfacePermissionUiNode } {
  return node !== true;
}

/** Shape leaves that accept exactly one string sub-key (a language code for localized strings). */
const LOCALIZED_UI_LEAVES = new Set(['label', 'subLabel']);

function isAllowedInterfacePermissionUiPath(field: string, descendant: readonly string[]): boolean {
  if (descendant.length === 0) return false;
  let node: InterfacePermissionUiNode | undefined = INTERFACE_PERMISSION_UI_SHAPES[field];
  if (node == null) return false;
  let lastKey = '';
  let inLocalizedLeaf = false;
  for (const segment of descendant) {
    if (inLocalizedLeaf) {
      // Already consumed one language-key segment; no further depth is valid.
      return false;
    }
    if (!isUiShapeMap(node)) {
      // Reached a primitive leaf; localized record leaves accept exactly one more key.
      if (!LOCALIZED_UI_LEAVES.has(lastKey)) return false;
      inLocalizedLeaf = true;
      continue;
    }
    lastKey = segment;
    node = node[segment];
    if (node == null) return false;
  }
  return true;
}

/** Returns true if a dot-path should be blocked from config override writes.
 *
 *  Depth-2 paths (`interface.mcpServers`) return `true` because writing a bare
 *  composite field would include permission sub-keys — callers should write
 *  individual sub-key paths instead (e.g. `interface.mcpServers.placeholder`).
 *  Use `stripInterfacePermissionFields` when handling full interface objects.
 *
 *  - `interface.prompts` → true (boolean permission field, fully blocked)
 *  - `interface.mcpServers` → true (bare composite path, blocked)
 *  - `interface.mcpServers.use` → true (permission sub-key, blocked)
 *  - `interface.mcpServers.placeholder` → false (UI sub-key, allowed)
 *  - `interface.runCode.placeholder` → true (UI key owned by a different field)
 *  - `interface.runCode.foo` → true (unknown descendant of permission field)
 *  - `interface.peoplePicker.users` → true (permission sub-key, blocked)
 *  - `interface.endpointsMenu` → false (pure UI field) */
export function isInterfacePermissionPath(fieldPath: string): boolean {
  const segments = fieldPath.split('.');
  if (segments[0] !== 'interface' || segments.length < 2) return false;
  if (!INTERFACE_PERMISSION_FIELDS.has(segments[1])) return false;
  // Bare field path (e.g. `interface.prompts` or `interface.mcpServers`) —
  // blocked because writing the whole field could include permission bits.
  if (segments.length === 2) return true;
  if (PERMISSION_SUB_KEYS.has(segments[2])) return true;
  return !isAllowedInterfacePermissionUiPath(segments[1], segments.slice(2));
}

function pickAllowedUiSubtree(
  value: Record<string, unknown>,
  shape: { readonly [key: string]: InterfacePermissionUiNode },
): Record<string, unknown> | undefined {
  const filtered: Record<string, unknown> = {};
  let hasKeys = false;
  for (const [subKey, subValue] of Object.entries(value)) {
    if (PERMISSION_SUB_KEYS.has(subKey)) continue;
    const childShape = shape[subKey];
    if (childShape == null) continue;
    if (childShape === true) {
      if (LOCALIZED_UI_LEAVES.has(subKey)) {
        if (subValue === null || typeof subValue !== 'object') {
          filtered[subKey] = subValue;
          hasKeys = true;
        } else if (!Array.isArray(subValue)) {
          const localized: Record<string, unknown> = {};
          for (const [langKey, langVal] of Object.entries(subValue as Record<string, unknown>)) {
            if (langVal === null || typeof langVal !== 'object') {
              localized[langKey] = langVal;
            }
          }
          if (Object.keys(localized).length > 0) {
            filtered[subKey] = localized;
            hasKeys = true;
          }
        }
      } else if (subValue === null || typeof subValue !== 'object') {
        filtered[subKey] = subValue;
        hasKeys = true;
      }
      continue;
    }
    if (subValue && typeof subValue === 'object' && !Array.isArray(subValue)) {
      const nested = pickAllowedUiSubtree(subValue as Record<string, unknown>, childShape);
      if (nested) {
        filtered[subKey] = nested;
        hasKeys = true;
      }
    }
  }
  return hasKeys ? filtered : undefined;
}

/** Strips permission fields and permission sub-keys from an interface config
 *  object. Boolean permission fields are removed entirely; composite permission
 *  fields keep only that field's known UI-only sub-keys. */
export function stripInterfacePermissionFields(
  obj: Partial<TInterfaceConfig>,
): Partial<TInterfaceConfig> {
  const result: Partial<TInterfaceConfig> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!INTERFACE_PERMISSION_FIELDS.has(key)) {
      (result as Record<string, unknown>)[key] = value;
      continue;
    }
    const shape = INTERFACE_PERMISSION_UI_SHAPES[key];
    if (shape == null || !isUiShapeMap(shape)) continue;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const filtered = pickAllowedUiSubtree(value as Record<string, unknown>, shape);
      if (filtered) (result as Record<string, unknown>)[key] = filtered;
    }
  }
  return result;
}

/** Filters a schema tree's interface children, removing boolean permission fields
 *  entirely and stripping permission sub-key children from composite fields.
 *  Returns only fields/sub-fields that are editable in config overrides. */
export function filterInterfacePermissionChildren(
  children: t.SchemaField[],
  shape?: InterfacePermissionUiNode,
): t.SchemaField[] {
  return children.reduce<t.SchemaField[]>((acc, child) => {
    if (shape != null) {
      if (!isUiShapeMap(shape)) return acc;
      const childShape = shape[child.key];
      if (childShape == null) return acc;
      if (isUiShapeMap(childShape) && child.children?.length) {
        acc.push({
          ...child,
          children: filterInterfacePermissionChildren(child.children, childShape),
        });
      } else {
        acc.push(child);
      }
      return acc;
    }

    if (!INTERFACE_PERMISSION_FIELDS.has(child.key)) {
      acc.push(child);
      return acc;
    }
    const fieldShape = INTERFACE_PERMISSION_UI_SHAPES[child.key];
    if (fieldShape == null || !isUiShapeMap(fieldShape) || !child.children?.length) {
      return acc;
    }
    const uiChildren = filterInterfacePermissionChildren(child.children, fieldShape);
    if (uiChildren.length > 0) {
      acc.push({ ...child, children: uiChildren });
    }
    return acc;
  }, []);
}

/** Keys added by AppService that should be replaced with their canonical names.
 *  After normalization, these legacy keys must be deleted to avoid persisting
 *  redundant paths to the DB. */
const LEGACY_APP_SERVICE_KEYS = ['interfaceConfig', 'turnstileConfig', 'mcpConfig'] as const;

/** Normalizes an AppService/fallback config object to use canonical schema keys
 *  and strips interface permission fields. Removes legacy AppService key aliases
 *  so they aren't persisted alongside the canonical keys. */
export function normalizeImportConfig<T extends Record<string, unknown>>(appConfig: T): T {
  const normalized = {
    ...appConfig,
    interface: appConfig.interfaceConfig ?? appConfig.interface,
    turnstile: appConfig.turnstileConfig ?? appConfig.turnstile,
    mcpServers: appConfig.mcpConfig ?? appConfig.mcpServers,
  };
  for (const key of LEGACY_APP_SERVICE_KEYS) {
    delete normalized[key];
  }
  if (
    normalized.interface &&
    typeof normalized.interface === 'object' &&
    !Array.isArray(normalized.interface)
  ) {
    normalized.interface = stripInterfacePermissionFields(
      normalized.interface as Partial<TInterfaceConfig>,
    );
  }
  return normalized as T;
}
