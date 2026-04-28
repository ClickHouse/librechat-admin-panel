import { useState } from 'react';
import { Tabs } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { CreateGroupDialog } from './CreateGroupDialog';
import { CreateRoleDialog } from './CreateRoleDialog';
import { GroupsTab } from './GroupsTab';
import { useLocalize } from '@/hooks';
import { RolesTab } from './RolesTab';
import { UsersPage } from '@/components/users';

export function AccessPage({
  activeTab,
  onTabChange,
  canReadRoles,
  canReadGroups,
  canReadUsers,
}: t.AccessPageProps) {
  const localize = useLocalize();
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [createRoleOpen, setCreateRoleOpen] = useState(false);
  const hasMultipleTabs = [canReadRoles, canReadGroups, canReadUsers].filter(Boolean).length > 1;

  return (
    <div
      role="region"
      aria-label={localize('com_nav_access')}
      className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-2"
    >
      {hasMultipleTabs && (
        <Tabs value={activeTab} onValueChange={onTabChange} ariaLabel={localize('com_nav_access')}>
          <Tabs.TriggersList>
            {canReadRoles && (
              <Tabs.Trigger value="roles">{localize('com_access_tab_roles')}</Tabs.Trigger>
            )}
            {canReadGroups && (
              <Tabs.Trigger value="groups">{localize('com_access_tab_groups')}</Tabs.Trigger>
            )}
            {canReadUsers && <Tabs.Trigger value="users">{localize('com_nav_users')}</Tabs.Trigger>}
          </Tabs.TriggersList>
          {canReadRoles && <Tabs.Content value="roles" tabIndex={-1} />}
          {canReadGroups && <Tabs.Content value="groups" tabIndex={-1} />}
          {canReadUsers && <Tabs.Content value="users" tabIndex={-1} />}
        </Tabs>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden pt-3">
        {activeTab === 'groups' && canReadGroups && (
          <GroupsTab onCreateGroup={() => setCreateGroupOpen(true)} />
        )}

        {activeTab === 'roles' && canReadRoles && (
          <RolesTab onCreateRole={() => setCreateRoleOpen(true)} />
        )}

        {activeTab === 'users' && canReadUsers && <UsersPage />}
      </div>

      <CreateGroupDialog open={createGroupOpen} onClose={() => setCreateGroupOpen(false)} />
      <CreateRoleDialog open={createRoleOpen} onClose={() => setCreateRoleOpen(false)} />
    </div>
  );
}
