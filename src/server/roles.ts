/**
 * Server functions for role management.
 *
 * Calls the LibreChat Admin API (/api/admin/roles) for all
 * role CRUD, permission updates, and membership operations.
 */

import { z } from 'zod';
import { queryOptions } from '@tanstack/react-query';
import { SystemRoles } from 'librechat-data-provider';
import { createServerFn } from '@tanstack/react-start';
import type { AdminMember } from '@librechat/data-schemas';
import type * as t from '@/types';
import { apiFetch, extractApiError } from './utils/api';
import { MEMBERS_PAGE_SIZE } from './groups';
import { tenantQueryKeys } from './keys';

// ── Helpers ──────────────────────────────────────────────────────────

interface RawRole {
  _id: string;
  name: string;
  description?: string;
  permissions?: Record<string, Record<string, boolean>>;
}

const SYSTEM_ROLE_NAMES = new Set<string>([SystemRoles.ADMIN, SystemRoles.USER]);

function toRole(raw: RawRole): t.Role {
  return {
    id: raw.name,
    name: raw.name,
    description: raw.description ?? '',
    isSystemRole: SYSTEM_ROLE_NAMES.has(raw.name),
    isActive: true,
    userCount: 0,
    permissions: (raw.permissions && !Array.isArray(raw.permissions)
      ? raw.permissions
      : {}) as t.RolePermissions,
  };
}

// ── Constants ─────────────────────────────────────────────────────────

export const ROLES_PAGE_SIZE = 50;

/** Backend max per request is 200. Consumers needing all roles use this cap. */
const ALL_ROLES_LIMIT = 200;

// ── Server functions ─────────────────────────────────────────────────

export const getRolesFn = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      limit: z.number().optional(),
      offset: z.number().optional(),
      expectedTenantId: z.string(),
    }),
  )
  .handler(
    async ({
      data,
    }: {
      data: { limit?: number; offset?: number; expectedTenantId: string };
    }): Promise<{ roles: t.Role[]; total: number }> => {
      const params = new URLSearchParams();
      if (data.limit != null) params.set('limit', String(data.limit));
      if (data.offset != null) params.set('offset', String(data.offset));
      const qs = params.toString();
      const response = await apiFetch(
        `/api/admin/roles${qs ? `?${qs}` : ''}`,
        undefined,
        data.expectedTenantId,
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch roles: ${response.status}`);
      }
      const json = (await response.json()) as { roles: RawRole[]; total: number };
      return { roles: json.roles.map(toRole), total: json.total };
    },
  );

export const rolesQueryOptions = (expectedTenantId: string, page = 1) =>
  queryOptions<{ roles: t.Role[]; total: number }>({
    queryKey: [...tenantQueryKeys.roles(expectedTenantId), page],
    queryFn: () =>
      getRolesFn({
        data: {
          limit: ROLES_PAGE_SIZE,
          offset: (page - 1) * ROLES_PAGE_SIZE,
          expectedTenantId,
        },
      }),
    staleTime: 30_000,
  });

export const allRolesQueryOptions = (expectedTenantId: string) =>
  queryOptions<t.Role[]>({
    queryKey: tenantQueryKeys.allRoles(expectedTenantId),
    queryFn: () =>
      getRolesFn({ data: { limit: ALL_ROLES_LIMIT, expectedTenantId } }).then((r) => r.roles),
    staleTime: 30_000,
  });

export const allRolesForTenantQueryOptions = allRolesQueryOptions;

export const getRoleFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ name: z.string(), expectedTenantId: z.string() }))
  .handler(
    async ({
      data,
    }: {
      data: { name: string; expectedTenantId: string };
    }): Promise<{ role: t.Role }> => {
      const response = await apiFetch(
        `/api/admin/roles/${encodeURIComponent(data.name)}`,
        undefined,
        data.expectedTenantId,
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch role: ${response.status}`);
      }
      const json = (await response.json()) as { role: RawRole };
      return { role: toRole(json.role) };
    },
  );

export const roleQueryOptions = (roleName: string, expectedTenantId: string) =>
  queryOptions<t.Role>({
    queryKey: tenantQueryKeys.roleDetail(expectedTenantId, roleName),
    queryFn: () => getRoleFn({ data: { name: roleName, expectedTenantId } }).then((r) => r.role),
    staleTime: 30_000,
  });

export const getRoleAssignmentsFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ expectedTenantId: z.string() }))
  .handler(
    async (): Promise<{ assignments: Record<string, t.AssignmentRef[]> }> => ({ assignments: {} }),
  );

export const roleAssignmentsQueryOptions = (expectedTenantId: string) =>
  queryOptions({
    queryKey: tenantQueryKeys.roleAssignments(expectedTenantId),
    queryFn: () => getRoleAssignmentsFn({ data: { expectedTenantId } }).then((r) => r.assignments),
    staleTime: 30_000,
  });

export const createRoleFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      expectedTenantId: z.string(),
    }),
  )
  .handler(
    async ({
      data,
    }: {
      data: { name: string; description?: string; expectedTenantId: string };
    }) => {
      const response = await apiFetch(
        '/api/admin/roles',
        {
          method: 'POST',
          body: JSON.stringify({ name: data.name, description: data.description }),
        },
        data.expectedTenantId,
      );
      if (!response.ok) {
        await extractApiError(response, 'Failed to create role');
      }
      const { role } = (await response.json()) as { role: RawRole };
      return { role: toRole(role) };
    },
  );

export const updateRoleFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      id: z.string(),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      expectedTenantId: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    const response = await apiFetch(
      `/api/admin/roles/${encodeURIComponent(data.id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ name: data.name, description: data.description }),
      },
      data.expectedTenantId,
    );
    if (!response.ok) {
      await extractApiError(response, 'Failed to update role');
    }
    const { role } = (await response.json()) as { role: RawRole };
    return { role: toRole(role) };
  });

export const updateRolePermissionsFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      id: z.string(),
      permissions: z.record(z.string(), z.record(z.string(), z.boolean())),
      expectedTenantId: z.string(),
    }),
  )
  .handler(
    async ({
      data,
    }: {
      data: {
        id: string;
        permissions: Record<string, Record<string, boolean>>;
        expectedTenantId: string;
      };
    }) => {
      const response = await apiFetch(
        `/api/admin/roles/${encodeURIComponent(data.id)}/permissions`,
        {
          method: 'PATCH',
          body: JSON.stringify({ permissions: data.permissions }),
        },
        data.expectedTenantId,
      );
      if (!response.ok) {
        await extractApiError(response, 'Failed to update role permissions');
      }
      const { role } = (await response.json()) as { role: RawRole };
      return { role: toRole(role) };
    },
  );

export const deleteRoleFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string(), expectedTenantId: z.string() }))
  .handler(async ({ data }) => {
    const response = await apiFetch(
      `/api/admin/roles/${encodeURIComponent(data.id)}`,
      { method: 'DELETE' },
      data.expectedTenantId,
    );
    if (!response.ok && response.status !== 404) {
      await extractApiError(response, 'Failed to delete role');
    }
    return { success: true };
  });

export const getRoleMembersFn = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      roleId: z.string(),
      limit: z.number().optional(),
      offset: z.number().optional(),
      expectedTenantId: z.string(),
    }),
  )
  .handler(
    async ({
      data,
    }: {
      data: { roleId: string; limit?: number; offset?: number; expectedTenantId: string };
    }): Promise<{ members: AdminMember[]; total: number }> => {
      const params = new URLSearchParams();
      if (data.limit != null) params.set('limit', String(data.limit));
      if (data.offset != null) params.set('offset', String(data.offset));
      const qs = params.toString();
      const url = `/api/admin/roles/${encodeURIComponent(data.roleId)}/members${qs ? `?${qs}` : ''}`;
      const response = await apiFetch(url, undefined, data.expectedTenantId);
      if (!response.ok) {
        throw new Error(`Failed to fetch role members: ${response.status}`);
      }
      const json = (await response.json()) as { members: AdminMember[]; total: number };
      return { members: json.members, total: json.total };
    },
  );

export const roleMembersQueryOptions = (roleId: string, expectedTenantId: string, page = 1) =>
  queryOptions<{ members: AdminMember[]; total: number }>({
    queryKey: tenantQueryKeys.roleMemberPage(expectedTenantId, roleId, page),
    queryFn: () =>
      getRoleMembersFn({
        data: {
          roleId,
          limit: MEMBERS_PAGE_SIZE,
          offset: (page - 1) * MEMBERS_PAGE_SIZE,
          expectedTenantId,
        },
      }),
    staleTime: 30_000,
  });

export const addRoleMemberFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({ roleId: z.string(), userId: z.string(), expectedTenantId: z.string() }),
  )
  .handler(async ({ data }) => {
    const response = await apiFetch(
      `/api/admin/roles/${encodeURIComponent(data.roleId)}/members`,
      {
        method: 'POST',
        body: JSON.stringify({ userId: data.userId }),
      },
      data.expectedTenantId,
    );
    if (!response.ok) {
      await extractApiError(response, 'Failed to add role member');
    }
    return { success: true };
  });

export const removeRoleMemberFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({ roleId: z.string(), userId: z.string(), expectedTenantId: z.string() }),
  )
  .handler(async ({ data }) => {
    const response = await apiFetch(
      `/api/admin/roles/${encodeURIComponent(data.roleId)}/members/${encodeURIComponent(data.userId)}`,
      { method: 'DELETE' },
      data.expectedTenantId,
    );
    if (!response.ok && response.status !== 404) {
      await extractApiError(response, 'Failed to remove role member');
    }
    return { success: true };
  });
