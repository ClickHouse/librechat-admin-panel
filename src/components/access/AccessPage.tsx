import { useState } from 'react';
import { Tabs } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { CreateGroupDialog } from './CreateGroupDialog';
import { CreateRoleDialog } from './CreateRoleDialog';
import { GroupsTab } from './GroupsTab';
import { useLocalize } from '@/hooks';
import { RolesTab } from './RolesTab';

export function AccessPage({
  activeTab,
  onTabChange,
  canReadRoles,
  canReadGroups,
  expectedTenantId,
}: t.AccessPageProps) {
  const localize = useLocalize();
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [createRoleOpen, setCreateRoleOpen] = useState(false);

  return (
    <div
      role="region"
      aria-label={localize('com_nav_access')}
      className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-2"
    >
      {canReadRoles && canReadGroups && (
        <Tabs value={activeTab} onValueChange={onTabChange} ariaLabel={localize('com_nav_access')}>
          <Tabs.TriggersList>
            <Tabs.Trigger value="roles">{localize('com_access_tab_roles')}</Tabs.Trigger>
            <Tabs.Trigger value="groups">{localize('com_access_tab_groups')}</Tabs.Trigger>
          </Tabs.TriggersList>
          <Tabs.Content value="roles" tabIndex={-1} />
          <Tabs.Content value="groups" tabIndex={-1} />
        </Tabs>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden pt-3">
        {activeTab === 'groups' && canReadGroups && (
          <GroupsTab
            expectedTenantId={expectedTenantId}
            onCreateGroup={() => setCreateGroupOpen(true)}
          />
        )}

        {activeTab === 'roles' && canReadRoles && (
          <RolesTab
            expectedTenantId={expectedTenantId}
            onCreateRole={() => setCreateRoleOpen(true)}
          />
        )}
      </div>

      <CreateGroupDialog
        open={createGroupOpen}
        expectedTenantId={expectedTenantId}
        onClose={() => setCreateGroupOpen(false)}
      />
      <CreateRoleDialog
        open={createRoleOpen}
        expectedTenantId={expectedTenantId}
        onClose={() => setCreateRoleOpen(false)}
      />
    </div>
  );
}
