import { useState } from 'react';
import { Button } from '@clickhouse/click-ui';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type * as t from '@/types';
import {
  LoadingState,
  Pagination,
  SearchInput,
  EmptyState,
  TrashButton,
} from '@/components/shared';
import { deleteRoleFn, rolesQueryOptions, ROLES_PAGE_SIZE } from '@/server';
import { useCapabilities, useLocalize } from '@/hooks';
import { EditRoleDialog } from './EditRoleDialog';
import { SystemCapabilities } from '@/constants';
import { ConfirmDialog } from './ConfirmDialog';
import { cn } from '@/utils';

export function RolesTab({ onCreateRole }: t.RolesTabProps) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const { hasCapability } = useCapabilities();
  const canManage = hasCapability(SystemCapabilities.MANAGE_ROLES);
  const [editTarget, setEditTarget] = useState<t.Role | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<t.Role | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, isError, isFetching } = useQuery({
    ...rolesQueryOptions(page),
    placeholderData: keepPreviousData,
  });

  const roles = data?.roles ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / ROLES_PAGE_SIZE);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRoleFn({ data: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      queryClient.invalidateQueries({ queryKey: ['availableScopes'] });
      queryClient.invalidateQueries({ queryKey: ['roleAssignments'] });
      queryClient.invalidateQueries({ queryKey: ['roleMembers'] });
      setDeleteTarget(null);
      setDeleteError('');
      if (roles.length === 1) {
        setPage((prev) => (prev > 1 ? prev - 1 : prev));
      }
    },
    onError: (err: Error) => setDeleteError(err.message),
  });

  const filtered = roles.filter((role) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return role.name.toLowerCase().includes(q) || role.description.toLowerCase().includes(q);
  });

  if (isLoading && !data) {
    return <LoadingState />;
  }

  if (isError && !data) {
    return <EmptyState message={localize('com_access_roles_error')} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto py-2 pr-1">
      <div className="flex items-center justify-between gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={localize('com_access_search_roles')}
        />
        <Button
          type="secondary"
          iconLeft="plus"
          label={localize('com_access_create_role')}
          onClick={onCreateRole}
          disabled={!canManage}
          aria-disabled={!canManage || undefined}
          title={
            !canManage
              ? localize('com_cap_no_permission', { cap: SystemCapabilities.MANAGE_ROLES })
              : undefined
          }
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          message={
            search && roles.length > 0
              ? localize('com_access_no_results')
              : localize('com_access_roles_empty')
          }
        />
      ) : (
        <div className={cn('flex flex-col', isFetching && 'opacity-60 transition-opacity')}>
          {filtered.map((role) => (
            <div
              key={role.id}
              className="mb-2 flex items-center gap-3 rounded-lg border border-(--cui-color-stroke-default) bg-(--cui-color-background-panel) px-3 py-3"
            >
              <button
                type="button"
                onClick={() => setEditTarget(role)}
                className="-my-2 -ml-2 min-w-0 flex-1 cursor-pointer rounded py-3 pl-3 text-left outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-(--cui-color-outline)"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-(--cui-color-text-default) hover:underline">
                    {role.name}
                  </span>
                  {role.isSystemRole && (
                    <span className="inline-block rounded-full bg-(--cui-color-background-secondary) px-2 py-0.5 text-[10px] font-medium text-(--cui-color-text-default)">
                      {localize('com_access_system_role')}
                    </span>
                  )}
                </div>
                {role.description && (
                  <div className="truncate text-xs text-(--cui-color-text-muted)">
                    {role.description}
                  </div>
                )}
              </button>

              {canManage && !role.isSystemRole && (
                <TrashButton
                  onClick={() => setDeleteTarget(role)}
                  ariaLabel={`${localize('com_ui_delete')} ${role.name}`}
                />
              )}
            </div>
          ))}
        </div>
      )}

      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />

      <EditRoleDialog
        key={editTarget?.id}
        role={editTarget}
        canManage={canManage}
        onClose={() => setEditTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title={localize('com_access_delete_role_title')}
        description={localize('com_access_delete_role_desc', { name: deleteTarget?.name ?? '' })}
        confirmLabel={localize('com_ui_delete')}
        saving={deleteMutation.isPending}
        error={deleteError}
        onConfirm={() => {
          setDeleteError('');
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError('');
        }}
      />
    </div>
  );
}
