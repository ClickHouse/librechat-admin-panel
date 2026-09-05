/**
 * Server functions for user management.
 *
 * Calls the LibreChat Admin API (/api/admin/users) for list, search, and delete.
 * Create user is not yet wired.
 */

import { z } from 'zod';
import { queryOptions } from '@tanstack/react-query';
import { SystemRoles } from 'librechat-data-provider';
import { createServerFn } from '@tanstack/react-start';
import type { AdminUserSearchResult } from '@librechat/data-schemas';
import type { TUser } from 'librechat-data-provider';
import { apiFetch, extractApiError } from './utils/api';
import { tenantQueryKeys } from './keys';

// ── Server functions ─────────────────────────────────────────────────

export const getUsersFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ expectedTenantId: z.string() }))
  .handler(async ({ data }): Promise<{ users: TUser[] }> => {
    const response = await apiFetch('/api/admin/users', undefined, data.expectedTenantId);
    if (!response.ok) {
      throw new Error(`Failed to fetch users: ${response.status}`);
    }
    const json = (await response.json()) as { users: TUser[] };
    return { users: json.users ?? [] };
  });

export const usersQueryOptions = (expectedTenantId: string) =>
  queryOptions({
    queryKey: tenantQueryKeys.users(expectedTenantId),
    queryFn: () => getUsersFn({ data: { expectedTenantId } }).then((r) => r.users),
    staleTime: 30_000,
  });

export const createUserFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      name: z.string().min(1),
      email: z.string().email(),
      role: z.nativeEnum(SystemRoles),
      expectedTenantId: z.string(),
    }),
  )
  .handler(async (): Promise<{ user: TUser }> => {
    throw new Error('Not implemented: createUserFn');
  });

export const deleteUserFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ id: z.string(), expectedTenantId: z.string() }))
  .handler(async ({ data }) => {
    const response = await apiFetch(
      `/api/admin/users/${encodeURIComponent(data.id)}`,
      { method: 'DELETE' },
      data.expectedTenantId,
    );
    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete user: ${response.status}`);
    }
  });

export const searchUsersFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ query: z.string(), expectedTenantId: z.string() }))
  .handler(async ({ data }): Promise<{ users: AdminUserSearchResult[] }> => {
    const response = await apiFetch(
      `/api/admin/users/search?q=${encodeURIComponent(data.query)}`,
      undefined,
      data.expectedTenantId,
    );
    if (!response.ok) {
      await extractApiError(response, 'Failed to search users');
    }
    const json = (await response.json()) as { users: AdminUserSearchResult[] };
    return { users: json.users ?? [] };
  });
