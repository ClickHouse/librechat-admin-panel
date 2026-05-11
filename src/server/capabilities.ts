/**
 * Server functions for SystemGrants capability management.
 *
 * Calls the LibreChat Admin API (/api/admin/grants) for grant reads,
 * assignment, and revocation. Effective-capabilities uses the JWT session
 * (no userId param needed).
 */

import { z } from 'zod';
import { keepPreviousData, queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { PrincipalType } from 'librechat-data-provider';
import { hasImpliedCapability, SystemCapabilities } from '@librechat/data-schemas/capabilities';
import type { AdminAuditLogEntry, AdminSystemGrant } from '@librechat/data-schemas';
import { apiFetch, extractApiError } from './utils/api';

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

export const getAllGrantsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ grants: AdminSystemGrant[] }> => {
    const response = await apiFetch('/api/admin/grants');
    if (!response.ok) {
      await extractApiError(response, 'Failed to fetch grants');
    }
    const json = (await response.json()) as { grants: RawGrant[] };
    return { grants: json.grants.map(toAdminSystemGrant) };
  },
);

export const allGrantsQueryOptions = queryOptions({
  queryKey: ['systemGrants'],
  queryFn: () => getAllGrantsFn().then((r) => r.grants),
  staleTime: 30_000,
});

export const getGrantsForPrincipalFn = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      principalType: z.nativeEnum(PrincipalType),
      principalId: z.string(),
    }),
  )
  .handler(
    async ({
      data,
    }: {
      data: { principalType: PrincipalType; principalId: string };
    }): Promise<{ grants: AdminSystemGrant[] }> => {
      const response = await apiFetch(
        `/api/admin/grants/${encodeURIComponent(data.principalType)}/${encodeURIComponent(data.principalId)}`,
      );
      if (!response.ok) {
        await extractApiError(response, 'Failed to fetch grants');
      }
      const json = (await response.json()) as { grants: RawGrant[] };
      return { grants: json.grants.map(toAdminSystemGrant) };
    },
  );

export const principalGrantsQueryOptions = (principalType: PrincipalType, principalId: string) =>
  queryOptions<AdminSystemGrant[]>({
    queryKey: ['systemGrants', principalType, principalId],
    queryFn: () =>
      getGrantsForPrincipalFn({ data: { principalType, principalId } }).then((r) => r.grants),
    staleTime: 30_000,
  });

export const getEffectiveCapabilitiesFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ capabilities: string[] }> => {
    const response = await apiFetch('/api/admin/grants/effective');
    if (!response.ok) {
      await extractApiError(response, 'Failed to fetch effective capabilities');
    }
    return (await response.json()) as { capabilities: string[] };
  },
);

/**
 * Defense-in-depth guard for server functions.
 * Fetches the current user's effective capabilities and throws if the
 * required capability is not held (directly or via implications).
 *
 * The LibreChat backend is the source of truth — this guard prevents
 * wasted round-trips for unauthorized operations.
 */
export async function requireCapability(capability: string): Promise<void> {
  const { capabilities } = await getEffectiveCapabilitiesFn();
  if (!hasImpliedCapability(capabilities, capability)) {
    throw new Error(`Insufficient permissions: requires ${capability}`);
  }
}

/** Require at least one of the given capabilities.
 * @throws if `required` is empty — callers must provide at least one capability. */
export async function requireAnyCapability(required: string[]): Promise<void> {
  if (required.length === 0) {
    throw new Error('No capabilities provided for check');
  }
  const { capabilities } = await getEffectiveCapabilitiesFn();
  for (const cap of required) {
    if (hasImpliedCapability(capabilities, cap)) return;
  }
  throw new Error(`Insufficient permissions: requires one of ${required.join(', ')}`);
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

export const effectiveCapabilitiesOptions = (userId: string) =>
  queryOptions<string[]>({
    queryKey: ['effectiveCapabilities', userId],
    queryFn: () => getEffectiveCapabilitiesFn().then((r) => r.capabilities),
    staleTime: 30_000,
  });

// ── Mutations ────────────────────────────────────────────────────────

export const grantCapabilityFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      principalType: z.nativeEnum(PrincipalType),
      principalId: z.string(),
      capability: z.string(),
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
      };
    }): Promise<{ success: boolean; grant: AdminSystemGrant }> => {
      const response = await apiFetch('/api/admin/grants', {
        method: 'POST',
        body: JSON.stringify({
          principalType: data.principalType,
          principalId: data.principalId,
          capability: data.capability,
        }),
      });
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
      };
    }): Promise<{ success: boolean }> => {
      const url = `/api/admin/grants/${encodeURIComponent(data.principalType)}/${encodeURIComponent(data.principalId)}/${encodeURIComponent(data.capability)}`;
      const response = await apiFetch(url, { method: 'DELETE' });
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
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z?)?$/,
    'Expected ISO 8601 date',
  );

const auditFilterSchema = z.object({
  search: z.string().max(200).optional(),
  action: z.enum(['grant_assigned', 'grant_removed']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export type AuditFilters = z.infer<typeof auditFilterSchema>;

const adminAuditLogEntrySchema = z.object({
  id: z.string(),
  action: z.enum(['grant_assigned', 'grant_removed']),
  actorId: z.string(),
  actorName: z.string(),
  targetPrincipalType: z.nativeEnum(PrincipalType),
  targetPrincipalId: z.string(),
  targetName: z.string(),
  capability: z.string(),
  timestamp: z.string(),
});

const auditLogResponseSchema = z.object({
  entries: z.array(adminAuditLogEntrySchema),
});

function buildAuditLogQuery(filters: AuditFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const getAuditLogFn = createServerFn({ method: 'GET' })
  .inputValidator(auditFilterSchema)
  .handler(
    async ({ data }: { data: AuditFilters }): Promise<{ entries: AdminAuditLogEntry[] }> => {
      await requireAnyCapability([
        SystemCapabilities.MANAGE_ROLES,
        SystemCapabilities.MANAGE_USERS,
        SystemCapabilities.MANAGE_GROUPS,
      ]);
      const response = await apiFetch(`/api/admin/audit-log${buildAuditLogQuery(data)}`);
      if (!response.ok) {
        await extractApiError(response, 'Failed to fetch audit log');
      }
      return auditLogResponseSchema.parse(await response.json());
    },
  );

export const auditLogQueryOptions = (filters: AuditFilters = {}) =>
  queryOptions<AdminAuditLogEntry[]>({
    queryKey: ['auditLog', filters],
    queryFn: () => getAuditLogFn({ data: filters }).then((r) => r.entries),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
