import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { useAppSession } from './session';
import { apiFetch, extractApiError } from './utils/api';

interface CpOrg {
  id: string;
  name: string;
  isCurrent: boolean;
}

interface CpOrgsResponse {
  orgs: CpOrg[];
}

interface CpSwitchOrgResponse {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    tenantId: string;
  };
}

function extractCookieValue(response: Response, name: string): string | undefined {
  const setCookies = response.headers.getSetCookie();
  const re = new RegExp(`^${name}=([^;]+)`);
  for (const cookie of setCookies) {
    const match = cookie.match(re);
    if (match) return match[1];
  }
  return undefined;
}

export const getCpOrgsFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const response = await apiFetch('/api/cp/orgs');
    if (!response.ok) {
      return { orgs: [] as CpOrg[] };
    }
    const data = (await response.json()) as CpOrgsResponse;
    return data;
  } catch {
    return { orgs: [] as CpOrg[] };
  }
});

export const switchCpOrgFn = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ targetOrgId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const response = await apiFetch('/api/cp/switch-org', {
      method: 'POST',
      body: JSON.stringify({ targetOrgId: data.targetOrgId }),
    });

    if (!response.ok) {
      await extractApiError(response, 'Failed to switch organization');
    }

    const result = (await response.json()) as CpSwitchOrgResponse;
    const newToken = response.headers.get('authorization')?.replace('Bearer ', '');
    const newRefreshToken = extractCookieValue(response, 'refreshToken');

    const session = await useAppSession();
    await session.update({
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.user.role,
      },
      ...(newToken ? { token: newToken } : {}),
      ...(newRefreshToken ? { refreshToken: newRefreshToken } : {}),
    });

    return { error: false, user: result.user };
  });
