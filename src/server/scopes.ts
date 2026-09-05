/**
 * Server functions for scope-based configuration profiles.
 *
 * Calls the LibreChat Admin Config API (/api/admin/config) for all
 * config override operations. No direct DB access.
 */

import { z } from 'zod';
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { PrincipalType } from 'librechat-data-provider';
import { SystemCapabilities } from '@librechat/data-schemas/capabilities';
import type {
  AdminConfigListResponse,
  AdminConfigResponse,
  AdminConfig,
} from '@librechat/data-schemas';
import type * as t from '@/types';
import {
  assertNoIndexedArrayResets,
  normalizeAppServiceKeys,
  parseIndexedArrayPath,
  mergeIndexedArrayEntriesIntoScopeOverlay,
} from './config';
import { isInterfacePermissionPath } from '@/utils/interfacePermissions';
import { BASE_CONFIG_PRINCIPAL_ID } from './constants';
import { requireAnyCapability } from './capabilities';
import { safeFieldPath } from './utils/validation';
import { tenantQueryKeys } from './keys';
import { apiFetch } from './utils/api';

// ── Dot-path helpers ─────────────────────────────────────────────────

function deepGet(obj: object, path: string): unknown {
  const keys = path.split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, never>)[key];
  }
  return current;
}

function deepSet(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const keys = path.split('.');
  const root: Record<string, unknown> = { ...obj };
  let cursor: Record<string, unknown> = root;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i]!;
    const existing = cursor[key];
    const next =
      existing != null && typeof existing === 'object' && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    cursor[key] = next;
    cursor = next;
  }
  cursor[keys[keys.length - 1]!] = value;
  return root;
}

async function getScopeOverrides(
  apiType: PrincipalType,
  principalId: string,
  expectedTenantId: string,
): Promise<Record<string, unknown>> {
  const response = await apiFetch(
    `/api/admin/config/${apiType}/${encodeURIComponent(principalId)}`,
    undefined,
    expectedTenantId,
  );
  if (response.status === 404) return {};
  if (!response.ok) throw new Error(`Failed to fetch config: ${response.status}`);
  const { config } = (await response.json()) as AdminConfigResponse;
  return normalizeAppServiceKeys((config.overrides ?? {}) as Record<string, t.ConfigValue>);
}

async function getBaseConfig(expectedTenantId: string): Promise<Record<string, unknown>> {
  const response = await apiFetch('/api/admin/config/base', undefined, expectedTenantId);
  if (!response.ok) throw new Error(`Failed to fetch base config: ${response.status}`);
  const { config } = (await response.json()) as { config: Record<string, t.ConfigValue> };
  return normalizeAppServiceKeys(config);
}

export async function mergeIndexedArrayEntriesForScope(
  apiType: PrincipalType,
  principalId: string,
  entries: Array<{ fieldPath: string; value: unknown }>,
  expectedTenantId: string,
): Promise<Array<{ fieldPath: string; value: unknown }>> {
  const indexed = new Map<string, Map<number, unknown>>();
  const rest: Array<{ fieldPath: string; value: unknown }> = [];
  const restByPath = new Map<string, number>();

  for (const entry of entries) {
    const parsed = parseIndexedArrayPath(entry.fieldPath);
    if (parsed.kind === 'invalid') {
      throw new Error(parsed.error);
    }
    if (parsed.kind === 'none') {
      restByPath.set(entry.fieldPath, rest.length);
      rest.push(entry);
      continue;
    }
    const { arrayPath, index } = parsed;
    if (!indexed.has(arrayPath)) indexed.set(arrayPath, new Map());
    indexed.get(arrayPath)!.set(index, entry.value);
  }

  if (indexed.size === 0) return entries;

  const [scopeOverrides, baseConfig] = await Promise.all([
    getScopeOverrides(apiType, principalId, expectedTenantId),
    getBaseConfig(expectedTenantId),
  ]);

  let overlay = scopeOverrides as Record<string, t.ConfigValue>;
  const pendingPaths = new Set<string>();
  for (const arrayPath of indexed.keys()) {
    const restIndex = restByPath.get(arrayPath);
    if (restIndex === undefined) continue;
    const pending = rest[restIndex]?.value;
    overlay = deepSet(overlay, arrayPath, pending) as Record<string, t.ConfigValue>;
    pendingPaths.add(arrayPath);
  }

  const indexedEntries: Array<{ fieldPath: string; value: unknown }> = [];
  for (const [arrayPath, updates] of indexed) {
    for (const [idx, value] of updates) {
      indexedEntries.push({ fieldPath: `${arrayPath}.${idx}`, value });
    }
  }

  const nonIndexedRest = rest.filter((entry) => !pendingPaths.has(entry.fieldPath));
  return mergeIndexedArrayEntriesIntoScopeOverlay(
    [...nonIndexedRest, ...indexedEntries],
    baseConfig as Record<string, t.ConfigValue>,
    overlay,
  );
}

// ── API helpers ──────────────────────────────────────────────────────

function apiConfigToScope(config: AdminConfig, nameMap?: Map<string, string>): t.ConfigScope {
  return {
    _id: config._id,
    principalType: config.principalType,
    principalId: config.principalId,
    name: nameMap?.get(config.principalId) ?? config.principalId,
    priority: config.priority,
    isActive: config.isActive,
  };
}

// ── Server functions ─────────────────────────────────────────────────

/**
 * Fetch all available scopes (all config overrides in the DB).
 */
export const getAvailableScopesFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ expectedTenantId: z.string() }))
  .handler(async ({ data }: { data: { expectedTenantId: string } }) => {
    const [configRes, groupsRes] = await Promise.all([
      apiFetch('/api/admin/config', undefined, data.expectedTenantId),
      apiFetch('/api/admin/groups?limit=200', undefined, data.expectedTenantId).catch(() => null),
    ]);
    if (!configRes.ok) {
      throw new Error(`Failed to fetch scopes: ${configRes.status}`);
    }
    const { configs } = (await configRes.json()) as AdminConfigListResponse;

    const nameMap = new Map<string, string>();
    if (groupsRes?.ok) {
      const { groups } = (await groupsRes.json()) as { groups: { _id: string; name: string }[] };
      for (const g of groups) nameMap.set(g._id, g.name);
    }

    const scopes: t.ConfigScope[] = configs
      .filter((c) => c.principalId !== BASE_CONFIG_PRINCIPAL_ID)
      .map((c) => apiConfigToScope(c, nameMap));
    return { scopes };
  });

/** Shared queryOptions so every consumer deduplicates and caches the scopes list. */
export const availableScopesOptions = (expectedTenantId: string) =>
  queryOptions({
    queryKey: tenantQueryKeys.availableScopes(expectedTenantId),
    queryFn: () => getAvailableScopesFn({ data: { expectedTenantId } }).then((r) => r.scopes),
    staleTime: 30_000,
  });

/**
 * Fetch all profile values for a specific field across all scopes.
 * Fetches all configs and extracts the field value from each config's overrides.
 */
export const getFieldProfileValuesFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ fieldPath: z.string(), expectedTenantId: z.string() }))
  .handler(async ({ data }: { data: { fieldPath: string; expectedTenantId: string } }) => {
    const response = await apiFetch('/api/admin/config', undefined, data.expectedTenantId);
    if (!response.ok) {
      throw new Error(`Failed to fetch configs: ${response.status}`);
    }
    const { configs } = (await response.json()) as AdminConfigListResponse;

    const values: t.FieldProfileValue[] = [];
    for (const config of configs) {
      if (config.principalId === BASE_CONFIG_PRINCIPAL_ID) continue;
      const value = deepGet(config.overrides, data.fieldPath);
      if (value !== undefined) {
        values.push({
          scope: apiConfigToScope(config),
          value: value as NonNullable<unknown>,
        });
      }
    }
    return { fieldPath: data.fieldPath, values };
  });

/** Shared queryOptions for fetching a single field's profile values. */
export const fieldProfileValuesOptions = (fieldPath: string, expectedTenantId: string) =>
  queryOptions<t.FieldProfileValue[]>({
    queryKey: tenantQueryKeys.fieldProfileValues(expectedTenantId, fieldPath),
    queryFn: () =>
      getFieldProfileValuesFn({ data: { fieldPath, expectedTenantId } }).then((r) => r.values),
  });

/**
 * Batch fetch profile principal types for many fields at once.
 * Fetches all configs once and checks each field path across all configs.
 */
export const getBatchFieldProfilesFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ paths: z.array(z.string()), expectedTenantId: z.string() }))
  .handler(async ({ data }: { data: { paths: string[]; expectedTenantId: string } }) => {
    const response = await apiFetch('/api/admin/config', undefined, data.expectedTenantId);
    if (!response.ok) {
      throw new Error(`Failed to fetch configs: ${response.status}`);
    }
    const { configs } = (await response.json()) as AdminConfigListResponse;

    const map: Record<string, string[]> = {};
    for (const path of data.paths) {
      const principalTypes: string[] = [];
      for (const config of configs) {
        if (config.principalId === BASE_CONFIG_PRINCIPAL_ID) continue;
        if (deepGet(config.overrides, path) !== undefined) {
          principalTypes.push(config.principalType);
        }
      }
      if (principalTypes.length > 0) {
        map[path] = principalTypes;
      }
    }
    return { profileMap: map };
  });

/**
 * Fetch the resolved (merged) config for a specific scope.
 * Returns the config's overrides with the changed field paths.
 */
export const getResolvedConfigFn = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      principalType: z.nativeEnum(PrincipalType),
      principalId: z.string(),
      expectedTenantId: z.string(),
    }),
  )
  .handler(
    async ({
      data,
    }: {
      data: { principalType: PrincipalType; principalId: string; expectedTenantId: string };
    }) => {
      const apiType = data.principalType;
      const response = await apiFetch(
        `/api/admin/config/${apiType}/${encodeURIComponent(data.principalId)}`,
        undefined,
        data.expectedTenantId,
      );

      if (response.status === 404) {
        return { resolvedConfig: {}, changedPaths: [] };
      }
      if (!response.ok) {
        throw new Error(`Failed to fetch config: ${response.status}`);
      }

      const { config } = (await response.json()) as AdminConfigResponse;
      const overrides = config.overrides ?? {};

      const changedPaths: string[] = [];
      const resolvedConfig: t.FlatConfigMap = {};

      function flatten(obj: object, prefix: string) {
        for (const [key, value] of Object.entries(obj)) {
          const path = prefix ? `${prefix}.${key}` : key;
          if (value != null && typeof value === 'object' && !Array.isArray(value)) {
            flatten(value as object, path);
          } else {
            changedPaths.push(path);
            resolvedConfig[path] = value as t.FlatConfigMap[string];
          }
        }
      }
      flatten(overrides, '');

      return { resolvedConfig, changedPaths };
    },
  );

/**
 * Save a field profile value for a specific scope.
 */
export const saveFieldProfileValueFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      fieldPath: safeFieldPath,
      principalType: z.nativeEnum(PrincipalType),
      principalId: z.string(),
      expectedTenantId: z.string(),
      value: z.unknown().refine((v) => v != null, 'Profile value must not be null or undefined'),
    }),
  )
  .handler(async ({ data }) => {
    await requireAnyCapability([
      SystemCapabilities.ASSIGN_CONFIGS,
      SystemCapabilities.MANAGE_CONFIGS,
    ]);
    if (isInterfacePermissionPath(data.fieldPath)) return { success: true };
    const apiType = data.principalType;
    const entries = await mergeIndexedArrayEntriesForScope(
      apiType,
      data.principalId,
      [{ fieldPath: data.fieldPath, value: data.value }],
      data.expectedTenantId,
    );
    const response = await apiFetch(
      `/api/admin/config/${apiType}/${encodeURIComponent(data.principalId)}/fields`,
      {
        method: 'PATCH',
        body: JSON.stringify({ entries }),
      },
      data.expectedTenantId,
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(
        (err as { error?: string }).error ?? `Failed to save field: ${response.status}`,
      );
    }
    return { success: true };
  });

/**
 * Save many field profile values for one scope in a single call.
 */
export const bulkSaveProfileValuesFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      principalType: z.nativeEnum(PrincipalType),
      principalId: z.string(),
      expectedTenantId: z.string(),
      entries: z.array(
        z.object({
          fieldPath: safeFieldPath,
          value: z
            .unknown()
            .refine((v) => v != null, 'Profile value must not be null or undefined'),
        }),
      ),
    }),
  )
  .handler(
    async ({
      data,
    }: {
      data: {
        principalType: PrincipalType;
        principalId: string;
        expectedTenantId: string;
        entries: Array<{ fieldPath: string; value: unknown }>;
      };
    }) => {
      await requireAnyCapability([
        SystemCapabilities.ASSIGN_CONFIGS,
        SystemCapabilities.MANAGE_CONFIGS,
      ]);
      const filtered = data.entries.filter((e) => !isInterfacePermissionPath(e.fieldPath));
      if (filtered.length === 0) return { success: true, count: 0 };
      const apiType = data.principalType;
      const entries = await mergeIndexedArrayEntriesForScope(
        apiType,
        data.principalId,
        filtered,
        data.expectedTenantId,
      );
      const response = await apiFetch(
        `/api/admin/config/${apiType}/${encodeURIComponent(data.principalId)}/fields`,
        {
          method: 'PATCH',
          body: JSON.stringify({ entries }),
        },
        data.expectedTenantId,
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error ?? `Failed to save fields: ${response.status}`,
        );
      }
      return { success: true, count: entries.length };
    },
  );

/**
 * Create a new scope by upserting a config with empty overrides.
 */
export const createScopeFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z
      .object({
        principalType: z.nativeEnum(PrincipalType),
        name: z.string().min(1),
        priority: z.number().int().min(0),
        principalId: z.string().optional(),
        expectedTenantId: z.string(),
      })
      .refine((d) => d.principalType !== PrincipalType.USER || !!d.principalId, {
        message: 'principalId is required for USER scopes',
        path: ['principalId'],
      })
      .refine((d) => d.principalId !== BASE_CONFIG_PRINCIPAL_ID, {
        message: 'Cannot create a scope with the reserved base config ID',
        path: ['principalId'],
      }),
  )
  .handler(
    async ({
      data,
    }: {
      data: {
        principalType: PrincipalType;
        name: string;
        priority: number;
        principalId?: string;
        expectedTenantId: string;
      };
    }) => {
      await requireAnyCapability([
        SystemCapabilities.ASSIGN_CONFIGS,
        SystemCapabilities.MANAGE_CONFIGS,
      ]);
      const principalId =
        data.principalId ??
        (data.principalType === PrincipalType.ROLE
          ? data.name.toLowerCase().replace(/\s+/g, '_')
          : `grp_${data.name.toLowerCase().replace(/\s+/g, '_')}`);

      const apiType = data.principalType;
      const response = await apiFetch(
        `/api/admin/config/${apiType}/${encodeURIComponent(principalId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({ overrides: {}, priority: data.priority }),
        },
        data.expectedTenantId,
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error ?? `Failed to create scope: ${response.status}`,
        );
      }

      const body = (await response.json()) as AdminConfigResponse | { message?: string };
      const config = 'config' in body ? body.config : undefined;
      if (!config?._id) {
        throw new Error(
          'Backend did not return a config document. The scope may not have been created.',
        );
      }
      const scope: t.ConfigScope = {
        _id: config._id,
        principalType: data.principalType,
        principalId,
        name: data.name,
        priority: data.priority,
        memberCount: data.principalType === PrincipalType.GROUP ? 0 : undefined,
        isActive: true,
      };
      return { scope };
    },
  );

/**
 * Remove a field profile value for a specific scope.
 */
export const removeFieldProfileValueFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      fieldPath: safeFieldPath,
      principalType: z.nativeEnum(PrincipalType),
      principalId: z.string(),
      expectedTenantId: z.string(),
    }),
  )
  .handler(
    async ({
      data,
    }: {
      data: {
        fieldPath: string;
        principalType: PrincipalType;
        principalId: string;
        expectedTenantId: string;
      };
    }) => {
      if (isInterfacePermissionPath(data.fieldPath)) return { success: true };
      assertNoIndexedArrayResets([data.fieldPath]);
      await requireAnyCapability([
        SystemCapabilities.ASSIGN_CONFIGS,
        SystemCapabilities.MANAGE_CONFIGS,
      ]);
      const apiType = data.principalType;
      const response = await apiFetch(
        `/api/admin/config/${apiType}/${encodeURIComponent(data.principalId)}/fields?fieldPath=${encodeURIComponent(data.fieldPath)}`,
        { method: 'DELETE' },
        data.expectedTenantId,
      );

      if (!response.ok && response.status !== 404) {
        const err = await response.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error ?? `Failed to remove field: ${response.status}`,
        );
      }
      return { success: true };
    },
  );

/**
 * Suppress an inherited field value for a specific scope.
 */
export const tombstoneFieldProfileValueFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      fieldPath: safeFieldPath,
      principalType: z.nativeEnum(PrincipalType),
      principalId: z.string(),
      expectedTenantId: z.string(),
    }),
  )
  .handler(
    async ({
      data,
    }: {
      data: {
        fieldPath: string;
        principalType: PrincipalType;
        principalId: string;
        expectedTenantId: string;
      };
    }) => {
      if (isInterfacePermissionPath(data.fieldPath)) return { success: true };
      assertNoIndexedArrayResets([data.fieldPath]);
      await requireAnyCapability([
        SystemCapabilities.ASSIGN_CONFIGS,
        SystemCapabilities.MANAGE_CONFIGS,
      ]);
      const apiType = data.principalType;
      const response = await apiFetch(
        `/api/admin/config/${apiType}/${encodeURIComponent(data.principalId)}/fields/tombstone`,
        {
          method: 'POST',
          body: JSON.stringify({ fieldPath: data.fieldPath }),
        },
        data.expectedTenantId,
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error ?? `Failed to tombstone field: ${response.status}`,
        );
      }
      return { success: true };
    },
  );

/**
 * Toggle a scope's isActive flag.
 */
export const toggleScopeActiveFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      principalType: z.nativeEnum(PrincipalType),
      principalId: z.string(),
      isActive: z.boolean(),
      expectedTenantId: z.string(),
    }),
  )
  .handler(
    async ({
      data,
    }: {
      data: {
        principalType: PrincipalType;
        principalId: string;
        isActive: boolean;
        expectedTenantId: string;
      };
    }) => {
      await requireAnyCapability([
        SystemCapabilities.ASSIGN_CONFIGS,
        SystemCapabilities.MANAGE_CONFIGS,
      ]);
      const apiType = data.principalType;
      const response = await apiFetch(
        `/api/admin/config/${apiType}/${encodeURIComponent(data.principalId)}/active`,
        {
          method: 'PATCH',
          body: JSON.stringify({ isActive: data.isActive }),
        },
        data.expectedTenantId,
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error ?? `Failed to toggle scope: ${response.status}`,
        );
      }
      return { success: true };
    },
  );

/**
 * Delete a scope and all its config overrides.
 */
export const deleteScopeFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      principalType: z.nativeEnum(PrincipalType),
      principalId: z.string(),
      expectedTenantId: z.string(),
    }),
  )
  .handler(
    async ({
      data,
    }: {
      data: {
        principalType: PrincipalType;
        principalId: string;
        expectedTenantId: string;
      };
    }) => {
      await requireAnyCapability([
        SystemCapabilities.ASSIGN_CONFIGS,
        SystemCapabilities.MANAGE_CONFIGS,
      ]);
      const apiType = data.principalType;
      const response = await apiFetch(
        `/api/admin/config/${apiType}/${encodeURIComponent(data.principalId)}`,
        { method: 'DELETE' },
        data.expectedTenantId,
      );

      if (!response.ok && response.status !== 404) {
        const err = await response.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error ?? `Failed to delete scope: ${response.status}`,
        );
      }
      return { success: true };
    },
  );
