import { useMemo, useRef, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Dropdown } from '@clickhouse/click-ui';
import { Building2, Check } from 'lucide-react';
import { getCpOrgsFn, switchCpOrgFn } from '@/server';
import { useStripAriaExpanded, useLocalize } from '@/hooks';
import { cn } from '@/utils';

export function OrgSwitcher() {
  const localize = useLocalize();
  const triggerRef = useStripAriaExpanded<HTMLButtonElement>();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['cpOrgs'],
    queryFn: () => getCpOrgsFn(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const switchMutation = useMutation({
    mutationFn: (targetOrgId: string) => switchCpOrgFn({ data: { targetOrgId } }),
  });

  const orgs = useMemo(() => data?.orgs ?? [], [data]);
  const currentOrg = useMemo(() => orgs.find((o) => o.isCurrent), [orgs]);
  const mutateRef = useRef(switchMutation.mutateAsync);
  mutateRef.current = switchMutation.mutateAsync;

  const handleSwitch = useCallback(
    async (orgId: string) => {
      if (orgId === currentOrg?.id) return;
      try {
        await mutateRef.current(orgId);
        window.location.reload();
      } catch {
        // error handled by mutation state
      }
    },
    [currentOrg?.id],
  );

  if (isLoading || isError || orgs.length < 2) return null;

  return (
    <Dropdown>
      <Dropdown.Trigger>
        <button
          ref={triggerRef}
          type="button"
          disabled={switchMutation.isPending}
          className={cn(
            'flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-(--cui-color-stroke-default) bg-(--cui-color-background-default) transition-colors',
            'hover:border-(--cui-color-stroke-intense) hover:bg-(--cui-color-background-hover)',
            switchMutation.isPending && 'opacity-50 cursor-not-allowed',
          )}
          aria-label={currentOrg?.name ?? localize('com_nav_switch_org')}
          title={currentOrg?.name ?? localize('com_nav_switch_org')}
        >
          <Building2 className="h-3.5 w-3.5 text-(--cui-color-text-muted)" aria-hidden="true" />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Content>
        <div className="flex min-w-50 flex-col select-none">
          <div className="px-3 py-2 text-xs font-medium text-(--cui-color-text-muted)">
            {localize('com_nav_organizations')}
          </div>
          {orgs.map((org) => (
            <Dropdown.Item
              key={org.id}
              onClick={() => handleSwitch(org.id)}
              disabled={switchMutation.isPending}
            >
              <div className="flex w-full items-center justify-between">
                <span className="truncate">{org.name}</span>
                {org.isCurrent && (
                  <Check
                    className="ml-2 h-3.5 w-3.5 shrink-0 text-(--cui-color-text-default)"
                    aria-hidden="true"
                  />
                )}
              </div>
            </Dropdown.Item>
          ))}
        </div>
      </Dropdown.Content>
    </Dropdown>
  );
}
