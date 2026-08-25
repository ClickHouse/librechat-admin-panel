import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PrincipalType, PermissionTypes } from 'librechat-data-provider';
import type * as t from '@/types';
import { ScopeSelector } from './ScopeSelector';

const mocks = vi.hoisted(() => ({
  scopesQueryFn: vi.fn(),
  rolesQueryFn: vi.fn(),
  groupsQueryFn: vi.fn(),
  createScopeFn: vi.fn(),
  deleteScopeFn: vi.fn(),
}));

vi.mock('@/server', () => ({
  availableScopesOptions: { queryKey: ['availableScopes'], queryFn: mocks.scopesQueryFn },
  allRolesQueryOptions: { queryKey: ['allRoles'], queryFn: mocks.rolesQueryFn },
  allGroupsQueryOptions: { queryKey: ['allGroups'], queryFn: mocks.groupsQueryFn },
  createScopeFn: mocks.createScopeFn,
  deleteScopeFn: mocks.deleteScopeFn,
}));

vi.mock('@/hooks/useLocalize', () => ({
  default: () => (key: string) => key,
  useLocalize: () => (key: string) => key,
}));

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
Element.prototype.scrollIntoView = vi.fn();

const emptyPermissions = Object.fromEntries(
  Object.values(PermissionTypes).map((type) => [type, {}]),
) as t.RolePermissions;

const engineeringScope: t.ConfigScope = {
  principalType: PrincipalType.ROLE,
  principalId: 'role-1',
  name: 'Engineering',
  priority: 10,
  isActive: true,
};

const engineeringRole: t.Role = {
  id: 'role-1',
  name: 'Engineering',
  description: 'Engineering team',
  isSystemRole: false,
  isActive: true,
  userCount: 0,
  permissions: emptyPermissions,
};

const marketingRole: t.Role = {
  id: 'role-2',
  name: 'Marketing',
  description: 'Growth team',
  isSystemRole: false,
  isActive: true,
  userCount: 0,
  permissions: emptyPermissions,
};

function renderSelector() {
  const onSelect = vi.fn();
  const onOpenChange = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ScopeSelector
        open
        onOpenChange={onOpenChange}
        currentSelection={{ type: 'BASE' }}
        onSelect={onSelect}
        permissions={{ canView: true, canEdit: true }}
      />
    </QueryClientProvider>,
  );
  return { onSelect, onOpenChange };
}

async function renderListView() {
  const handlers = renderSelector();
  await screen.findByText('Engineering');
  await waitFor(() =>
    expect(document.querySelector('[cmdk-item][aria-selected="true"]')).not.toBeNull(),
  );
  return handlers;
}

async function openDeleteConfirmationFromList(user: ReturnType<typeof userEvent.setup>) {
  const deleteButton = screen.getByRole('button', { name: 'com_scope_delete' });
  deleteButton.focus();
  await user.keyboard('{Enter}');
  await screen.findByText('com_scope_delete_confirm');
}

async function openDeleteConfirmation(user: ReturnType<typeof userEvent.setup>) {
  const handlers = await renderListView();
  await openDeleteConfirmationFromList(user);
  return handlers;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.scopesQueryFn.mockResolvedValue([engineeringScope]);
  mocks.rolesQueryFn.mockResolvedValue([engineeringRole, marketingRole]);
  mocks.groupsQueryFn.mockResolvedValue([]);
  mocks.createScopeFn.mockResolvedValue({});
  mocks.deleteScopeFn.mockResolvedValue({});
});

describe('ScopeSelector Enter key handling', () => {
  it('opens the creation view when Enter is pressed on the focused Create button', async () => {
    const user = userEvent.setup();
    const { onSelect, onOpenChange } = await renderListView();
    const createButton = screen.getByRole('button', { name: 'com_scope_create' });
    createButton.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText('com_scope_create_new')).toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('does not close the dialog or select the Base scope when Enter is pressed in the empty search input', async () => {
    const user = userEvent.setup();
    const { onSelect, onOpenChange } = await renderListView();
    screen.getByRole('combobox').focus();
    await user.keyboard('{Enter}');
    expect(onSelect).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('creates a configuration when Enter is pressed on a focused role button in the creation view', async () => {
    const user = userEvent.setup();
    await renderListView();
    screen.getByRole('button', { name: 'com_scope_create' }).focus();
    await user.keyboard('{Enter}');
    const roleButton = await screen.findByRole('button', { name: /Marketing/ });
    roleButton.focus();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(mocks.createScopeFn).toHaveBeenCalledWith({
        data: {
          principalType: PrincipalType.ROLE,
          name: 'Marketing',
          priority: 10,
          principalId: 'role-2',
        },
      }),
    );
  });

  it('opens the delete confirmation without selecting the scope when Enter is pressed on a delete button', async () => {
    const user = userEvent.setup();
    const { onSelect, onOpenChange } = await openDeleteConfirmation(user);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('deletes the scope once when Enter is pressed on the focused Delete button in the confirmation view', async () => {
    const user = userEvent.setup();
    await openDeleteConfirmation(user);
    const confirmButton = screen.getByRole('button', { name: 'com_scope_delete' });
    await waitFor(() => expect(confirmButton).toHaveFocus());
    await user.keyboard('{Enter}');
    await waitFor(() => expect(mocks.deleteScopeFn).toHaveBeenCalledTimes(1));
    expect(mocks.deleteScopeFn).toHaveBeenCalledWith({
      data: { principalType: PrincipalType.ROLE, principalId: 'role-1' },
    });
  });

  it('returns to the list without deleting when Enter is pressed on the focused Cancel button', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = await openDeleteConfirmation(user);
    const cancelButton = screen.getByRole('button', { name: 'com_ui_cancel' });
    cancelButton.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('combobox')).toBeInTheDocument();
    expect(mocks.deleteScopeFn).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('does not select the auto-highlighted Base scope with Enter after cancelling a delete reached by hovering', async () => {
    const user = userEvent.setup();
    const { onSelect, onOpenChange } = await renderListView();
    await user.hover(screen.getByText('Engineering'));
    await openDeleteConfirmationFromList(user);
    const cancelButton = screen.getByRole('button', { name: 'com_ui_cancel' });
    cancelButton.focus();
    await user.keyboard('{Enter}');
    const searchInput = await screen.findByRole('combobox');
    searchInput.focus();
    await user.keyboard('{Enter}');
    expect(onSelect).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('selects a scope with Enter after hovering it with the mouse', async () => {
    const user = userEvent.setup();
    const { onSelect, onOpenChange } = await renderListView();
    await user.hover(screen.getByText('Engineering'));
    screen.getByRole('combobox').focus();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith({ type: 'SCOPE', scope: engineeringScope });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('still selects a scope with arrow navigation followed by Enter', async () => {
    const user = userEvent.setup();
    const { onSelect, onOpenChange } = await renderListView();
    screen.getByRole('combobox').focus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelect).toHaveBeenCalledWith({ type: 'SCOPE', scope: engineeringScope });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
