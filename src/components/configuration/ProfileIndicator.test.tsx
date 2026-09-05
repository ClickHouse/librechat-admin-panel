import { describe, expect, it, vi } from 'vitest';
import { PrincipalType } from 'librechat-data-provider';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { ProfileIndicator } from './ProfileIndicator';

const fetchProfileValuesMock = vi.hoisted(() => vi.fn());

vi.mock('@/server', () => ({
  fieldProfileValuesOptions: (fieldPath: string, expectedTenantId: string) => ({
    queryKey: ['fieldProfileValues', expectedTenantId, fieldPath],
    queryFn: fetchProfileValuesMock,
  }),
  tenantQueryKeys: {
    fieldProfileValues: (tenantId: string, fieldPath: string) =>
      ['fieldProfileValues', tenantId, fieldPath] as const,
  },
}));

vi.mock('@/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

vi.mock('@clickhouse/click-ui', () => {
  const Dialog = Object.assign(({ children }: { children: ReactNode }) => <>{children}</>, {
    Content: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  });
  return { Dialog, Icon: () => null };
});

vi.mock('./FieldProfilePopover', () => ({
  FieldProfilePopover: ({
    profileValues,
    onProfileChange,
  }: {
    profileValues: t.FieldProfileValue[];
    onProfileChange: () => void;
  }) => (
    <div>
      <output>{String(profileValues[0]?.value ?? '')}</output>
      <button type="button" onClick={onProfileChange}>
        mutate profile
      </button>
    </div>
  ),
}));

function profileValue(value: string): t.FieldProfileValue {
  return {
    scope: {
      principalType: PrincipalType.ROLE,
      principalId: 'role-1',
      name: 'Role 1',
      priority: 100,
      isActive: true,
    },
    value,
  };
}

describe('ProfileIndicator', () => {
  it('refreshes tenant-scoped profile values while the parent dialog remains open', async () => {
    fetchProfileValuesMock
      .mockResolvedValueOnce([profileValue('old')])
      .mockResolvedValueOnce([profileValue('new')]);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ProfileIndicator
          fieldPath="mcpServers"
          fieldLabel="MCP servers"
          expectedTenantId="tenant-a"
          profileTypes={[PrincipalType.ROLE]}
          permissions={{ canView: true, canEdit: true, canAssign: true }}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'com_scope_field_profiles: MCP servers' }));
    await screen.findByText('old');

    fireEvent.click(screen.getByRole('button', { name: 'mutate profile' }));
    await screen.findByText('new');

    expect(fetchProfileValuesMock).toHaveBeenCalledTimes(2);
  });
});
