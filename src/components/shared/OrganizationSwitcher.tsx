import { useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { Button, Icon, Select } from '@clickhouse/click-ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminOrganizationsQueryOptions, switchAdminOrganizationFn } from '@/server';
import { useLocalize } from '@/hooks';

export function OrganizationSwitcher() {
  const localize = useLocalize();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const organizationsQuery = useQuery(adminOrganizationsQueryOptions);
  const switchMutation = useMutation({
    mutationFn: (targetOrgId: string) => switchAdminOrganizationFn({ data: { targetOrgId } }),
    onSuccess: async () => {
      try {
        await queryClient.invalidateQueries();
        await router.invalidate();
        await router.navigate({ to: '/' });
      } catch {
        setSwitchingTo(null);
      }
    },
    onError: () => {
      setSwitchingTo(null);
      setSelectedOrgId('');
    },
  });

  if (switchingTo) {
    return (
      <div
        role="status"
        className="fixed inset-0 z-50 flex items-center justify-center gap-2 bg-(--cui-color-background-default) text-(--cui-color-text-muted)"
      >
        <Icon name="loading-animated" size="sm" />
        <span className="text-sm">
          {localize('com_admin_org_switcher_switching_to', { org: switchingTo })}
        </span>
      </div>
    );
  }

  const organizations = organizationsQuery.data ?? [];
  if (organizations.length === 0) return null;

  const startSwitch = (organization: { id: string; name: string }) => {
    setSwitchingTo(organization.name);
    switchMutation.mutate(organization.id);
  };

  const error = switchMutation.isError && (
    <p role="alert" className="text-sm text-(--cui-color-text-danger)">
      {localize('com_admin_org_switcher_error')}
    </p>
  );

  if (organizations.length === 1) {
    const organization = organizations[0];
    return (
      <div className="flex w-full max-w-sm flex-col gap-2">
        <Button
          type="primary"
          label={localize('com_admin_org_switcher_continue', { org: organization.name })}
          onClick={() => startSwitch(organization)}
          disabled={switchMutation.isPending}
        />
        {error}
      </div>
    );
  }

  const selected = organizations.find((organization) => organization.id === selectedOrgId);
  return (
    <div className="flex w-full max-w-sm flex-col gap-2">
      <Select
        label={localize('com_admin_org_switcher_label')}
        placeholder={localize('com_admin_org_switcher_placeholder')}
        value={selectedOrgId || undefined}
        onSelect={(value) => setSelectedOrgId(value)}
      >
        {organizations.map((organization) => (
          <Select.Item key={organization.id} value={organization.id}>
            {organization.name}
          </Select.Item>
        ))}
      </Select>
      <Button
        type="primary"
        label={
          selected
            ? localize('com_admin_org_switcher_switch_to', { org: selected.name })
            : localize('com_admin_org_switcher_switch')
        }
        onClick={() => selected && startSwitch(selected)}
        disabled={!selected || switchMutation.isPending}
      />
      {error}
    </div>
  );
}
