/**
 * Server functions for SystemGrants capability management.
 *
 * Calls the LibreChat Admin API (/api/admin/grants) for grant reads,
 * assignment, and revocation. Effective-capabilities uses the JWT session
 * (no userId param needed).
 */

import { z } from 'zod';
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { PrincipalType } from 'librechat-data-provider';
import { hasImpliedCapability, SystemCapabilities } from '@librechat/data-schemas/capabilities';
import type { AdminSystemGrant } from '@librechat/data-schemas';
import type * as t from '@/types';
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_OUTCOMES,
  AUDIT_SEVERITIES,
  AUDIT_ACTOR_TYPES,
  READ_AUDIT_LOG_CAPABILITY,
  isAuditEntryId,
} from '@/constants';
import { apiFetch, extractApiError } from './utils/api';
import { tenantQueryKeys } from './keys';

// ── Helpers ──────────────────────────────────────────────────────────

interface RawGrant {
  _id: string;
  principalType: PrincipalType;
  principalId: string;
  capability: string;
  tenantId?: string;
  grantedBy?: string;
  grantedAt?: string;
  expiresAt?: string;
}

function toAdminSystemGrant(raw: RawGrant): AdminSystemGrant {
  return {
    id: raw._id,
    principalType: raw.principalType,
    principalId: raw.principalId,
    capability: raw.capability,
    grantedBy: raw.grantedBy,
    grantedAt: raw.grantedAt ?? new Date().toISOString(),
    expiresAt: raw.expiresAt,
  };
}

// ── Reads ────────────────────────────────────────────────────────────

export const getAllGrantsFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ expectedTenantId: z.string() }))
  .handler(async ({ data }): Promise<{ grants: AdminSystemGrant[] }> => {
    const response = await apiFetch('/api/admin/grants', undefined, data.expectedTenantId);
    if (!response.ok) {
      await extractApiError(response, 'Failed to fetch grants');
    }
    const json = (await response.json()) as { grants: RawGrant[] };
    return { grants: json.grants.map(toAdminSystemGrant) };
  });

export const allGrantsQueryOptions = (expectedTenantId: string) =>
  queryOptions({
    queryKey: tenantQueryKeys.grants(expectedTenantId),
    queryFn: () => getAllGrantsFn({ data: { expectedTenantId } }).then((r) => r.grants),
    staleTime: 30_000,
  });

export const getGrantsForPrincipalFn = createServerFn({ method: 'GET' })
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
    }): Promise<{ grants: AdminSystemGrant[] }> => {
      const response = await apiFetch(
        `/api/admin/grants/${encodeURIComponent(data.principalType)}/${encodeURIComponent(data.principalId)}`,
        undefined,
        data.expectedTenantId,
      );
      if (!response.ok) {
        await extractApiError(response, 'Failed to fetch grants');
      }
      const json = (await response.json()) as { grants: RawGrant[] };
      return { grants: json.grants.map(toAdminSystemGrant) };
    },
  );

export const principalGrantsQueryOptions = (
  principalType: PrincipalType,
  principalId: string,
  expectedTenantId: string,
) =>
  queryOptions<AdminSystemGrant[]>({
    queryKey: tenantQueryKeys.principalGrants(expectedTenantId, principalType, principalId),
    queryFn: () =>
      getGrantsForPrincipalFn({ data: { principalType, principalId, expectedTenantId } }).then(
        (r) => r.grants,
      ),
    staleTime: 30_000,
  });

async function fetchEffectiveCapabilities(expectedTenantId?: string) {
  const response = await apiFetch('/api/admin/grants/effective', undefined, expectedTenantId);
  if (!response.ok) {
    await extractApiError(response, 'Failed to fetch effective capabilities');
  }
  const payload = (await response.json()) as {
    capabilities?: string[];
    effectiveTenantId?: string;
  };
  if (!Array.isArray(payload.capabilities) || typeof payload.effectiveTenantId !== 'string') {
    throw new Error('Effective capabilities response is missing its tenant context');
  }
  return {
    capabilities: payload.capabilities,
    effectiveTenantId: payload.effectiveTenantId,
  };
}

export const getEffectiveCapabilitiesFn = createServerFn({ method: 'GET' }).handler(() =>
  fetchEffectiveCapabilities(),
);

export const getTenantCapabilitiesFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ expectedTenantId: z.string() }))
  .handler(async ({ data }): Promise<t.TenantCapabilitiesResponse> => {
    const response = await apiFetch(
      '/api/admin/grants/effective',
      undefined,
      data.expectedTenantId,
    );
    if (response.status === 409) {
      const payload = (await response.json().catch(() => ({}))) as { currentTenantId?: string };
      if (typeof payload.currentTenantId !== 'string') {
        throw new Error('Tenant context changed without identifying the current tenant');
      }
      return { tenantChanged: true, currentTenantId: payload.currentTenantId };
    }
    if (!response.ok) {
      await extractApiError(response, 'Failed to fetch effective capabilities');
    }
    const payload = (await response.json()) as Partial<t.EffectiveCapabilitiesResponse>;
    if (!Array.isArray(payload.capabilities) || typeof payload.effectiveTenantId !== 'string') {
      throw new Error('Effective capabilities response is missing its tenant context');
    }
    return {
      tenantChanged: false,
      capabilities: payload.capabilities,
      effectiveTenantId: payload.effectiveTenantId,
    };
  });

/**
 * Defense-in-depth guard for server functions.
 * Fetches the current user's effective capabilities and throws if the
 * required capability is not held (directly or via implications).
 *
 * The LibreChat backend is the source of truth — this guard prevents
 * wasted round-trips for unauthorized operations.
 */
export async function requireCapability(
  capability: string,
  expectedTenantId?: string,
): Promise<void> {
  const { capabilities } = await fetchEffectiveCapabilities(expectedTenantId);
  if (!hasImpliedCapability(capabilities, capability)) {
    throw new Error(`Insufficient permissions: requires ${capability}`);
  }
}

/** Check `requireAnyCapability` against an already-fetched capability set.
 * Lets handlers reuse a single effective-capabilities lookup across the guard
 * and any follow-up backend call instead of hitting `/effective` twice. */
export function checkAnyCapability(held: string[], required: readonly string[]): void {
  if (required.length === 0) {
    throw new Error('No capabilities provided for check');
  }
  for (const cap of required) {
    if (hasImpliedCapability(held, cap)) return;
  }
  throw new Error(`Insufficient permissions: requires one of ${required.join(', ')}`);
}

/** Require at least one of the given capabilities.
 * @throws if `required` is empty — callers must provide at least one capability. */
export async function requireAnyCapability(required: string[]): Promise<void> {
  const { capabilities } = await getEffectiveCapabilitiesFn();
  checkAnyCapability(capabilities, required);
}

/**
 * Require a capability for every config section in a batch.
 * Short-circuits if the user holds the broad MANAGE_CONFIGS capability.
 * Otherwise checks `manage:configs:{section}` for each unique section.
 * @throws if `sections` is empty — callers must validate input length.
 */
export async function requireAllSectionCapabilities(sections: string[]): Promise<void> {
  if (sections.length === 0) {
    throw new Error('No sections provided for capability check');
  }
  const { capabilities } = await getEffectiveCapabilitiesFn();
  if (hasImpliedCapability(capabilities, SystemCapabilities.MANAGE_CONFIGS)) return;
  for (const section of sections) {
    if (!hasImpliedCapability(capabilities, `manage:configs:${section}`)) {
      throw new Error(`Insufficient permissions: requires manage:configs:${section}`);
    }
  }
}

export const effectiveCapabilitiesOptions = (userId: string, expectedTenantId: string) =>
  queryOptions<string[]>({
    queryKey: tenantQueryKeys.effectiveCapabilities(expectedTenantId, userId),
    queryFn: () => fetchEffectiveCapabilities(expectedTenantId).then((r) => r.capabilities),
    staleTime: 30_000,
  });

// ── Mutations ────────────────────────────────────────────────────────

export const grantCapabilityFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      principalType: z.nativeEnum(PrincipalType),
      principalId: z.string(),
      capability: z.string(),
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
        capability: string;
        expectedTenantId: string;
      };
    }): Promise<{ success: boolean; grant: AdminSystemGrant }> => {
      const response = await apiFetch(
        '/api/admin/grants',
        {
          method: 'POST',
          body: JSON.stringify({
            principalType: data.principalType,
            principalId: data.principalId,
            capability: data.capability,
          }),
        },
        data.expectedTenantId,
      );
      if (!response.ok) {
        await extractApiError(response, 'Failed to grant capability');
      }
      const json = (await response.json()) as { grant: RawGrant };
      return { success: true, grant: toAdminSystemGrant(json.grant) };
    },
  );

// TanStack Start server functions only support 'GET' and 'POST'; 'POST' is used here
// even though this handler proxies a DELETE to the backend.
export const revokeCapabilityFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      principalType: z.nativeEnum(PrincipalType),
      principalId: z.string(),
      capability: z.string(),
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
        capability: string;
        expectedTenantId: string;
      };
    }): Promise<{ success: boolean }> => {
      const url = `/api/admin/grants/${encodeURIComponent(data.principalType)}/${encodeURIComponent(data.principalId)}/${encodeURIComponent(data.capability)}`;
      const response = await apiFetch(url, { method: 'DELETE' }, data.expectedTenantId);
      if (!response.ok) {
        await extractApiError(response, 'Failed to revoke capability');
      }
      return { success: true };
    },
  );

// ── Audit Log ────────────────────────────────────────────────────────

const isoDate = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2}))?$/,
    'Expected ISO 8601 date',
  );

/**
 * Wire format for `/api/admin/audit-log` filters, mirroring the LibreChat
 * backend's general-purpose audit query. `actorQuery` / `targetQuery` are
 * case-insensitive substring matches on the denormalized actor/target names;
 * `category` / `action` / `outcome` / `severity` / `actorType` / `targetType`
 * are exact facet filters. `cursor` (the `seq` of the last row seen) drives
 * keyset pagination; `offset` remains for page-number navigation.
 */
const auditFilterSchema = z.object({
  search: z.string().max(200).optional(),
  category: z.array(z.enum(AUDIT_CATEGORIES)).optional(),
  action: z.array(z.enum(AUDIT_ACTIONS)).optional(),
  outcome: z.array(z.enum(AUDIT_OUTCOMES)).optional(),
  severity: z.array(z.enum(AUDIT_SEVERITIES)).optional(),
  actorType: z.enum(AUDIT_ACTOR_TYPES).optional(),
  actorQuery: z.string().max(128).optional(),
  targetType: z.string().max(128).optional(),
  targetQuery: z.string().max(128).optional(),
  capability: z.string().max(128).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  cursor: z.number().int().min(1).optional(),
});

const tenantAuditFilterSchema = auditFilterSchema.extend({ expectedTenantId: z.string() });

export type AuditFilters = z.infer<typeof auditFilterSchema>;

const adminAuditLogEntrySchema = z.object({
  id: z.string(),
  schemaVersion: z.number(),
  category: z.enum(AUDIT_CATEGORIES),
  action: z.enum(AUDIT_ACTIONS),
  outcome: z.enum(AUDIT_OUTCOMES),
  severity: z.enum(AUDIT_SEVERITIES),
  actor: z.object({
    type: z.enum(AUDIT_ACTOR_TYPES),
    id: z.string().optional(),
    name: z.string(),
  }),
  target: z.object({
    type: z.string(),
    id: z.string().optional(),
    name: z.string().optional(),
  }),
  metadata: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .optional(),
  context: z
    .object({
      requestId: z.string().optional(),
      ip: z.string().optional(),
      userAgent: z.string().optional(),
      sessionId: z.string().optional(),
    })
    .optional(),
  tenantId: z.string().optional(),
  integrity: z.object({
    seq: z.number(),
    hash: z.string(),
    prevHash: z.string(),
  }),
  timestamp: z.string(),
  before: z.array(z.string()).optional(),
  after: z.array(z.string()).optional(),
});

const auditLogPageResponseSchema = z.object({
  entries: z.array(adminAuditLogEntrySchema),
  total: z.number().int().min(0),
  nextCursor: z.number().int().nullable(),
});

export type AuditLogPage = z.infer<typeof auditLogPageResponseSchema>;

export const AUDIT_LOG_PAGE_SIZE = 50;

/**
 * Defense-in-depth: the LibreChat backend `/api/admin/audit-log` route gates
 * on `ACCESS_ADMIN` + `READ_AUDIT_LOG`, but the BFF still calls
 * `requireCapability(READ_AUDIT_LOG_CAPABILITY)` so an authenticated admin
 * without `READ_AUDIT_LOG` is rejected at the proxy rather than relying on
 * the backend to return 403. This keeps the policy consistent with the UI
 * gate in `GrantsPage` and matches the established mutation-side pattern
 * (`requireAllSectionCapabilities`, etc.). The extra `/effective` round-trip
 * is amortized against React Query's per-user cache.
 */
function buildAuditLogQuery(filters: AuditFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, String(v));
    } else {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const getAuditLogPageFn = createServerFn({ method: 'GET' })
  .inputValidator(tenantAuditFilterSchema)
  .handler(async ({ data }): Promise<AuditLogPage> => {
    await requireCapability(READ_AUDIT_LOG_CAPABILITY, data.expectedTenantId);
    /**
     * The LibreChat `/api/admin/audit-log` endpoint is a general-purpose event
     * log, but this UI only renders (and `adminAuditLogEntrySchema` only parses)
     * grant rows. Force `category=grant` so a non-grant event can never reach
     * the strict parser and error the whole tab.
     */
    const { expectedTenantId, ...filters } = data;
    const withDefaults: AuditFilters = {
      limit: AUDIT_LOG_PAGE_SIZE,
      ...filters,
      category: ['grant'],
    };
    const response = await apiFetch(
      `/api/admin/audit-log${buildAuditLogQuery(withDefaults)}`,
      undefined,
      expectedTenantId,
    );
    if (!response.ok) {
      await extractApiError(response, 'Failed to fetch audit log');
    }
    return auditLogPageResponseSchema.parse(await response.json());
  });

export const auditLogQueryOptions = (
  expectedTenantId: string,
  page: number,
  filters: Omit<AuditFilters, 'offset' | 'limit'> = {},
) =>
  queryOptions({
    queryKey: tenantQueryKeys.auditLogPage(expectedTenantId, page, filters),
    queryFn: () =>
      getAuditLogPageFn({
        data: {
          ...filters,
          offset: (Math.max(1, page) - 1) * AUDIT_LOG_PAGE_SIZE,
          limit: AUDIT_LOG_PAGE_SIZE,
          expectedTenantId,
        },
      }),
    staleTime: 60_000,
  });

export const getAuditLogEntryFn = createServerFn({ method: 'GET' })
  /** Constrain to the backend's ObjectId shape so a crafted `entryId` (e.g.
   * `export.csv`) can't be proxied as a sibling audit-log sub-route. */
  .inputValidator(
    z.object({ id: z.string().regex(/^[a-f0-9]{24}$/i), expectedTenantId: z.string() }),
  )
  .handler(
    async ({
      data,
    }: {
      data: { id: string; expectedTenantId: string };
    }): Promise<{ entry: z.infer<typeof adminAuditLogEntrySchema> | null }> => {
      await requireCapability(READ_AUDIT_LOG_CAPABILITY, data.expectedTenantId);
      const response = await apiFetch(
        `/api/admin/audit-log/${encodeURIComponent(data.id)}`,
        undefined,
        data.expectedTenantId,
      );
      if (response.status === 404) return { entry: null };
      if (!response.ok) {
        await extractApiError(response, 'Failed to fetch audit log entry');
      }
      const json = (await response.json()) as { entry: unknown };
      return { entry: adminAuditLogEntrySchema.parse(json.entry) };
    },
  );

export const auditLogEntryQueryOptions = (id: string | undefined, expectedTenantId: string) =>
  queryOptions({
    queryKey: tenantQueryKeys.auditLogEntry(expectedTenantId, id),
    queryFn: () => getAuditLogEntryFn({ data: { id: id ?? '', expectedTenantId } }),
    /** Only fire for a well-formed id so a crafted `?entryId=` deep link can't
     * reach the server fn (which would reject it anyway). */
    enabled: isAuditEntryId(id),
    staleTime: 60_000,
  });

export const exportAuditLogServerFn = createServerFn({ method: 'POST' })
  .inputValidator(tenantAuditFilterSchema)
  .handler(async ({ data }): Promise<Response> => {
    await requireCapability(READ_AUDIT_LOG_CAPABILITY, data.expectedTenantId);
    /** Grant-scoped like the page fetch — this UI only deals with grant events. */
    const { expectedTenantId, ...filters } = data;
    const scoped: AuditFilters = { ...filters, category: ['grant'] };
    const response = await apiFetch(
      `/api/admin/audit-log/export.csv${buildAuditLogQuery(scoped)}`,
      {
        method: 'GET',
        headers: { Accept: 'text/csv' },
      },
      expectedTenantId,
    );
    if (!response.ok) {
      await extractApiError(response, 'Failed to export audit log');
    }
    /**
     * Stream the backend's CSV straight through rather than buffering the whole
     * file into a string + JSON server-function payload. This preserves the
     * backend's streaming/backpressure/cancellation and avoids exhausting BFF
     * memory or hitting server-function payload limits on large exports. A
     * server fn that returns a `Response` is passed through verbatim, so the
     * client receives this streamed body to turn into a download.
     */
    const filename = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(response.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  });
