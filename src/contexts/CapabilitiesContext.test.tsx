import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as t from '@/types';
import { CapabilitiesProvider, useCapabilitiesContext } from './CapabilitiesContext';

const getTenantCapabilitiesFnMock = vi.hoisted(() => vi.fn());

vi.mock('@/server', () => ({
  getTenantCapabilitiesFn: getTenantCapabilitiesFnMock,
  tenantQueryKeys: {
    effectiveCapabilities: (tenantId: string, userId: string) =>
      ['effectiveCapabilities', tenantId, userId] as const,
  },
}));

const user: t.SerializableUser = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'ADMIN',
  tenantId: 'tenant-a',
};

function CapabilitiesProbe() {
  const { capabilities, effectiveTenantId } = useCapabilitiesContext();
  return <output>{`${effectiveTenantId}:${capabilities.join(',')}`}</output>;
}

describe('CapabilitiesProvider tenant transitions', () => {
  it('refetches A→B→A and never serves capabilities under another tenant key', async () => {
    let currentTenantId = 'tenant-a';
    getTenantCapabilitiesFnMock.mockImplementation(
      async ({ data }: { data: { expectedTenantId: string } }) => {
        if (data.expectedTenantId !== currentTenantId) {
          return { tenantChanged: true, currentTenantId };
        }
        return {
          tenantChanged: false,
          effectiveTenantId: currentTenantId,
          capabilities: [`manage:${currentTenantId}`],
        };
      },
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const renderProvider = (navigationKey: string) => (
      <QueryClientProvider client={queryClient}>
        <CapabilitiesProvider user={user} navigationKey={navigationKey}>
          <CapabilitiesProbe />
        </CapabilitiesProvider>
      </QueryClientProvider>
    );
    const view = render(renderProvider('/access'));

    await screen.findByText('tenant-a:manage:tenant-a');

    currentTenantId = 'tenant-b';
    view.rerender(renderProvider('/grants'));
    await screen.findByText('tenant-b:manage:tenant-b');

    const tenantAData = queryClient.getQueryData<{
      capabilities?: string[];
    }>(['effectiveCapabilities', 'tenant-a', user.id]);
    expect(tenantAData?.capabilities ?? []).not.toContain('manage:tenant-b');
    expect(
      queryClient.getQueryData<{ capabilities?: string[] }>([
        'effectiveCapabilities',
        'tenant-b',
        user.id,
      ])?.capabilities,
    ).toContain('manage:tenant-b');

    currentTenantId = 'tenant-a';
    view.rerender(renderProvider('/access?return=1'));
    await screen.findByText('tenant-a:manage:tenant-a');

    await waitFor(() => expect(getTenantCapabilitiesFnMock).toHaveBeenCalledTimes(5));
  });
});
