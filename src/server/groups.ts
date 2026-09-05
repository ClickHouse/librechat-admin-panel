/**
 * Server functions for group management.
 *
 * Calls the LibreChat Admin API (/api/admin/groups) for all
 * group CRUD and membership operations. No direct DB access.
 */

import { z } from 'zod';
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import type { AdminGroup, AdminMember } from '@librechat/data-schemas';
import type * as t from '@/types';
import { apiFetch, extractApiError } from './utils/api';
import { tenantQueryKeys } from './keys';

// ── Helpers ──────────────────────────────────────────────────────────

interface RawGroup {
  _id: string;
  name: string;
  description?: string;
  email?: string;
  avatar?: string;
  memberIds?: string[];
  source: string;
  createdAt?: string;
  updatedAt?: string;
}

function toAdminGroup(raw: RawGroup): AdminGroup {
  return {
    id: raw._id,
    name: raw.name,
    description: raw.description ?? '',
    memberCount: raw.memberIds?.length ?? 0,
    topMembers: [],
    isActive: true,
  };
}

// ── Constants ─────────────────────────────────────────────────────────

export const GROUPS_PAGE_SIZE = 50;
export const MEMBERS_PAGE_SIZE = 50;

/** Backend max per request is 200. Consumers needing all groups use this cap. */
const ALL_GROUPS_LIMIT = 200;

const GROUP_SOURCE_LOCAL = 'local' as const;

// ── Server functions ─────────────────────────────────────────────────

export const getGroupsFn = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      search: z.string().optional(),
      limit: z.number().optional(),
      offset: z.number().optional(),
      expectedTenantId: z.string(),
    }),
  )
  .handler(
    async ({
      data,
    }: {
      data: { search?: string; limit?: number; offset?: number; expectedTenantId: string };
    }): Promise<{ groups: AdminGroup[]; total: number }> => {
      const params = new URLSearchParams();
      if (data.search) params.set('search', data.search);
      if (data.limit != null) params.set('limit', String(data.limit));
      if (data.offset != null) params.set('offset', String(data.offset));
      const qs = params.toString();
      const response = await apiFetch(
        `/api/admin/groups${qs ? `?${qs}` : ''}`,
        undefined,
        data.expectedTenantId,
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch groups: ${response.status}`);
      }
      const json = (await response.json()) as { groups: RawGroup[]; total: number };
      return { groups: json.groups.map(toAdminGroup), total: json.total };
    },
  );

export const groupsQueryOptions = (expectedTenantId: string, page = 1, search = '') =>
  queryOptions<{ groups: AdminGroup[]; total: number }>({
    queryKey: [...tenantQueryKeys.groups(expectedTenantId), page, search],
    queryFn: () =>
      getGroupsFn({
        data: {
          search: search || undefined,
          limit: GROUPS_PAGE_SIZE,
          offset: (page - 1) * GROUPS_PAGE_SIZE,
          expectedTenantId,
        },
      }),
    staleTime: 30_000,
  });

export const allGroupsQueryOptions = (expectedTenantId: string) =>
  queryOptions<AdminGroup[]>({
    queryKey: tenantQueryKeys.allGroups(expectedTenantId),
    queryFn: () =>
      getGroupsFn({ data: { limit: ALL_GROUPS_LIMIT, expectedTenantId } }).then((r) => r.groups),
    staleTime: 30_000,
  });

export const allGroupsForTenantQueryOptions = allGroupsQueryOptions;

export const getGroupAssignmentsFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ expectedTenantId: z.string() }))
  .handler(
    async (): Promise<{ assignments: Record<string, t.AssignmentRef[]> }> => ({ assignments: {} }),
  );

export const groupAssignmentsQueryOptions = (expectedTenantId: string) =>
  queryOptions({
    queryKey: tenantQueryKeys.groupAssignments(expectedTenantId),
    queryFn: () => getGroupAssignmentsFn({ data: { expectedTenantId } }).then((r) => r.assignments),
    staleTime: 30_000,
  });

export const createGroupFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      name: z.string().min(1),
      description: z.string().default(''),
      expectedTenantId: z.string(),
    }),
  )
  .handler(
    async ({ data }: { data: { name: string; description: string; expectedTenantId: string } }) => {
      const response = await apiFetch(
        '/api/admin/groups',
        {
          method: 'POST',
          body: JSON.stringify({
            name: data.name,
            description: data.description,
            source: GROUP_SOURCE_LOCAL,
          }),
        },
        data.expectedTenantId,
      );
      if (!response.ok) {
        await extractApiError(response, 'Failed to create group');
      }
      const { group } = (await response.json()) as { group: RawGroup };
      return { group: toAdminGroup(group) };
    },
  );

export const updateGroupFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      id: z.string(),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      expectedTenantId: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    const { id, expectedTenantId, ...body } = data;
    const response = await apiFetch(
      `/api/admin/groups/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(body),
      },
      expectedTenantId,
    );
    if (!response.ok) {
      await extractApiError(response, 'Failed to update group');
    }
    const { group } = (await response.json()) as { group: RawGroup };
    return { group: toAdminGroup(group) };
  });

export const deleteGroupFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string(), expectedTenantId: z.string() }))
  .handler(async ({ data }) => {
    const response = await apiFetch(
      `/api/admin/groups/${encodeURIComponent(data.id)}`,
      { method: 'DELETE' },
      data.expectedTenantId,
    );
    if (!response.ok && response.status !== 404) {
      await extractApiError(response, 'Failed to delete group');
    }
    return { success: true };
  });

export const getGroupMembersFn = createServerFn({ method: 'GET' })
  .inputValidator(
    z.object({
      groupId: z.string(),
      limit: z.number().optional(),
      offset: z.number().optional(),
      expectedTenantId: z.string(),
    }),
  )
  .handler(
    async ({
      data,
    }: {
      data: { groupId: string; limit?: number; offset?: number; expectedTenantId: string };
    }): Promise<{ members: AdminMember[]; total: number }> => {
      const params = new URLSearchParams();
      if (data.limit != null) params.set('limit', String(data.limit));
      if (data.offset != null) params.set('offset', String(data.offset));
      const qs = params.toString();
      const url = `/api/admin/groups/${encodeURIComponent(data.groupId)}/members${qs ? `?${qs}` : ''}`;
      const response = await apiFetch(url, undefined, data.expectedTenantId);
      if (!response.ok) {
        throw new Error(`Failed to fetch group members: ${response.status}`);
      }
      const json = (await response.json()) as { members: AdminMember[]; total: number };
      return { members: json.members, total: json.total };
    },
  );

export const groupMembersQueryOptions = (groupId: string, expectedTenantId: string, page = 1) =>
  queryOptions<{ members: AdminMember[]; total: number }>({
    queryKey: tenantQueryKeys.groupMemberPage(expectedTenantId, groupId, page),
    queryFn: () =>
      getGroupMembersFn({
        data: {
          groupId,
          limit: MEMBERS_PAGE_SIZE,
          offset: (page - 1) * MEMBERS_PAGE_SIZE,
          expectedTenantId,
        },
      }),
    staleTime: 30_000,
  });

export const addGroupMemberFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({ groupId: z.string(), userId: z.string(), expectedTenantId: z.string() }),
  )
  .handler(async ({ data }) => {
    const response = await apiFetch(
      `/api/admin/groups/${encodeURIComponent(data.groupId)}/members`,
      {
        method: 'POST',
        body: JSON.stringify({ userId: data.userId }),
      },
      data.expectedTenantId,
    );
    if (!response.ok) {
      await extractApiError(response, 'Failed to add member');
    }
    return { success: true };
  });

export const removeGroupMemberFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({ groupId: z.string(), userId: z.string(), expectedTenantId: z.string() }),
  )
  .handler(async ({ data }) => {
    const response = await apiFetch(
      `/api/admin/groups/${encodeURIComponent(data.groupId)}/members/${encodeURIComponent(data.userId)}`,
      { method: 'DELETE' },
      data.expectedTenantId,
    );
    if (!response.ok && response.status !== 404) {
      await extractApiError(response, 'Failed to remove member');
    }
    return { success: true };
  });
