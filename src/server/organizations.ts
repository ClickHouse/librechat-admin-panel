import { z } from 'zod';
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import type * as t from '@/types';
import { apiFetch, extractApiError } from './utils/api';
import { useAppSession } from './session';

export const getAdminOrganizationsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<{ orgs: t.AdminOrganization[] }> => {
    const response = await apiFetch('/api/admin/orgs');
    if (!response.ok) {
      await extractApiError(response, 'Failed to fetch organizations');
    }
    return (await response.json()) as { orgs: t.AdminOrganization[] };
  },
);

export const adminOrganizationsQueryOptions = queryOptions({
  queryKey: ['adminOrganizations'],
  queryFn: () => getAdminOrganizationsFn().then((response) => response.orgs),
  staleTime: 30_000,
  retry: false,
});

export const switchAdminOrganizationFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ targetOrgId: z.string().min(1) }))
  .handler(async ({ data }): Promise<{ user: t.SerializableUser }> => {
    const response = await apiFetch('/api/admin/orgs/switch', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      await extractApiError(response, 'Failed to switch organization');
    }

    const result = (await response.json()) as {
      token: string;
      user: t.SerializableUser;
    };
    const session = await useAppSession();
    const now = Date.now();
    await session.update({
      user: result.user,
      token: result.token,
      expiresAt: undefined,
      lastVerified: now,
      lastActivity: now,
    });

    return { user: result.user };
  });
