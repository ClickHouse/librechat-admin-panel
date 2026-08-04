import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { Select } from '@clickhouse/click-ui';
import { useLocalize } from '@/hooks';
import { adminOrganizationsQueryOptions, switchAdminOrganizationFn } from '@/server';

export function OrganizationSwitcher() {
  const localize = useLocalize();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const organizationsQuery = useQuery(adminOrganizationsQueryOptions);
  const switchMutation = useMutation({
    mutationFn: (targetOrgId: string) => switchAdminOrganizationFn({ data: { targetOrgId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['adminOrganizations'] });
      await router.invalidate();
      await router.navigate({ to: '/' });
    },
    onError: () => setSelectedOrgId(''),
  });

  const organizations = organizationsQuery.data ?? [];
  if (organizations.length === 0) return null;

  return (
    <div className="flex w-full max-w-sm flex-col gap-2">
      <Select
        label={localize('com_admin_org_switcher_label')}
        placeholder={localize('com_admin_org_switcher_placeholder')}
        value={selectedOrgId}
        onSelect={(value) => {
          setSelectedOrgId(value);
          switchMutation.mutate(value);
        }}
        disabled={switchMutation.isPending || organizationsQuery.isLoading}
      >
        {organizations.map((organization) => (
          <Select.Item key={organization.id} value={organization.id}>
            {organization.name}
          </Select.Item>
        ))}
      </Select>
      {switchMutation.isPending && (
        <p className="text-sm text-(--cui-color-text-muted)">
          {localize('com_admin_org_switcher_switching')}
        </p>
      )}
      {switchMutation.isError && (
        <p role="alert" className="text-sm text-(--cui-color-text-danger)">
          {localize('com_admin_org_switcher_error')}
        </p>
      )}
    </div>
  );
}
