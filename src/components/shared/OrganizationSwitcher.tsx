import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { Button, Icon, Select } from '@clickhouse/click-ui';
import { useLocalize } from '@/hooks';
import { adminOrganizationsQueryOptions, switchAdminOrganizationFn } from '@/server';

/** Keep the switch interstitial on screen at least this long so a fast switch
 * reads as a deliberate transition rather than a jarring flash. */
const MIN_INTERSTITIAL_MS = 400;

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
      // Hold the named interstitial briefly so a fast switch does not flash,
      // then refetch every query against the new session (the overlay hides the
      // refetch, so no previous-org data is ever shown) and re-run the loaders.
      await new Promise((resolve) => setTimeout(resolve, MIN_INTERSTITIAL_MS));
      await queryClient.invalidateQueries();
      await router.invalidate();
      await router.navigate({ to: '/' });
    },
    onError: () => {
      setSwitchingTo(null);
      setSelectedOrgId('');
    },
  });

  const organizations = organizationsQuery.data ?? [];
  if (organizations.length === 0) return null;

  const startSwitch = (organization: { id: string; name: string }) => {
    setSwitchingTo(organization.name);
    switchMutation.mutate(organization.id);
  };

  // Named, full-screen transition that covers the mutation + refetch + reroute,
  // so the context switch reads as intentional instead of snapping into place.
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

  const error = switchMutation.isError && (
    <p role="alert" className="text-sm text-(--cui-color-text-danger)">
      {localize('com_admin_org_switcher_error')}
    </p>
  );

  // Exactly one administered org: a single explicit action reads better than a
  // one-item dropdown, and still requires a deliberate click (no silent switch).
  if (organizations.length === 1) {
    const organization = organizations[0];
    return (
      <div className="flex w-full max-w-sm flex-col gap-2">
        <Button
          type="primary"
          label={localize('com_admin_org_switcher_continue', { org: organization.name })}
          onClick={() => startSwitch(organization)}
        />
        {error}
      </div>
    );
  }

  // Multiple orgs: selecting only sets the target; the switch is a separate,
  // deliberate click so a stray selection never navigates the user away.
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
        disabled={!selected}
      />
      {error}
    </div>
  );
}
