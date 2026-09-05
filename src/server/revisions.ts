import { z } from 'zod';
import { createServerFn } from '@tanstack/react-start';
import { queryOptions } from '@tanstack/react-query';
import { SystemCapabilities } from '@librechat/data-schemas/capabilities';
import type * as t from '@/types';
import { ConfigVersionConflictError } from './utils/errors';
import { apiFetch, extractApiError } from './utils/api';
import { BASE_CONFIG_PRINCIPAL_ID } from './constants';
import { requireCapability } from './capabilities';

export async function readAuthenticatedBaseConfigSnapshot(
  expectedTenantId?: string,
): Promise<t.RawBaseConfigSnapshot & { effectiveTenantId: string }> {
  const response = await apiFetch('/api/admin/config/base', undefined, expectedTenantId);
  if (!response.ok) {
    return extractApiError(response, 'Failed to fetch base config snapshot');
  }
  const payload = (await response.json()) as {
    dbOverrides?: unknown;
    dbConfigVersion?: number | null;
    effectiveTenantId?: string;
  };
  if (typeof payload.effectiveTenantId !== 'string') {
    throw new Error('Base config response is missing its effective tenant');
  }
  const configVersion = payload.dbConfigVersion ?? null;
  const overrides =
    payload.dbOverrides != null &&
    typeof payload.dbOverrides === 'object' &&
    !Array.isArray(payload.dbOverrides)
      ? (payload.dbOverrides as Record<string, t.ConfigValue>)
      : {};
  return {
    overrides,
    absent: configVersion == null,
    configVersion,
    effectiveTenantId: payload.effectiveTenantId,
  };
}

export const listConfigRevisionsFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ expectedTenantId: z.string() }))
  .handler(async ({ data }) => {
    await requireCapability(SystemCapabilities.MANAGE_CONFIGS);
    const response = await apiFetch(
      `/api/admin/config/role/${BASE_CONFIG_PRINCIPAL_ID}/revisions`,
      undefined,
      data.expectedTenantId,
    );
    if (!response.ok) {
      return extractApiError(response, 'Failed to list config revisions');
    }
    const payload = (await response.json()) as {
      revisions?: t.ConfigRevisionListItem[];
      effectiveTenantId?: string;
    };
    if (typeof payload.effectiveTenantId !== 'string') {
      throw new Error('Config revision response is missing its effective tenant');
    }
    return {
      revisions: Array.isArray(payload.revisions) ? payload.revisions : [],
      effectiveTenantId: payload.effectiveTenantId,
    };
  });

export const configRevisionsOptions = (userId: string, tenantId?: string) =>
  queryOptions({
    queryKey: ['configRevisions', tenantId ?? '', userId],
    queryFn: () => listConfigRevisionsFn({ data: { expectedTenantId: tenantId! } }),
    enabled: tenantId !== undefined,
    staleTime: 10_000,
    refetchOnMount: 'always',
  });

export const restoreConfigRevisionFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      /** The configVersion the admin's session was frozen against when the
       *  restore action began — never re-derived server-side, since a fresh
       *  read here would defeat stale-administrator detection entirely (see
       *  ConfigPage's session freeze). `null` means the session started from
       *  an absent document. */
      expectedVersion: z.number().int().min(0).nullable(),
      expectedTenantId: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    await requireCapability(SystemCapabilities.MANAGE_CONFIGS);
    const response = await apiFetch(
      `/api/admin/config/role/${BASE_CONFIG_PRINCIPAL_ID}/atomic`,
      {
        method: 'POST',
        body: JSON.stringify({
          expectedVersion: data.expectedVersion,
          expectedTenantId: data.expectedTenantId,
          cause: 'restore',
          restoreRevisionId: data.id,
        }),
      },
      data.expectedTenantId,
    );
    const payload = await response.json().catch(() => ({}));
    if (response.status === 409) {
      throw new ConfigVersionConflictError();
    }
    if (!response.ok) {
      throw new Error(
        (payload as { error?: string }).error ?? `Failed to restore config: ${response.status}`,
      );
    }
    return { success: true };
  });
