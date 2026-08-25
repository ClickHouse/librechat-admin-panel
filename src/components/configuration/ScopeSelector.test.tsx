import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrincipalType } from 'librechat-data-provider';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const PAGE_SIZE = 50;
const TOTAL_GROUPS = 60;

/** When set, group list requests block until the promise resolves. */
const mockListGate: { promise: Promise<void> | null } = { promise: null };

/** When set, group list requests fail with a 500. */
const mockListFail = { fail: false };

const allGroups = Array.from({ length: TOTAL_GROUPS }, (_, i) => ({
  _id: `grp-${i + 1}`,
  name: `Group ${String(i + 1).padStart(2, '0')}`,
  memberIds: [],
  source: 'entra',
}));

/** Every group on the first page already has a configuration; page two has eligible groups. */
const configuredGroups = allGroups.slice(0, PAGE_SIZE);

const configs = configuredGroups.map((group) => ({
  _id: `cfg-${group._id}`,
  principalType: PrincipalType.GROUP,
  principalId: group._id,
  priority: 20,
  isActive: true,
  overrides: {},
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator: () => ({
      handler: (fn: (...args: unknown[]) => unknown) => fn,
    }),
    handler: (fn: (...args: unknown[]) => unknown) => fn,
  }),
  createServerOnlyFn: (fn: (...args: unknown[]) => unknown) => fn,
}));

vi.mock('@/server/utils/api', () => ({
  apiFetch: vi.fn(async (url: string) => {
    const json = (body: object) => ({ ok: true, status: 200, json: async () => body });
    if (url === '/api/admin/config') return json({ configs });
    if (url.startsWith('/api/admin/roles')) return json({ roles: [], total: 0 });
    if (url.startsWith('/api/admin/groups?')) {
      if (mockListGate.promise) await mockListGate.promise;
      if (mockListFail.fail) {
        return { ok: false, status: 500, json: async () => ({ error: 'boom' }) };
      }
      const params = new URLSearchParams(url.split('?')[1]);
      const search = params.get('search')?.toLowerCase() ?? '';
      const limit = Number(params.get('limit') ?? 200);
      const offset = Number(params.get('offset') ?? 0);
      const matches = search
        ? allGroups.filter((group) => group.name.toLowerCase().includes(search))
        : allGroups;
      return json({ groups: matches.slice(offset, offset + limit), total: matches.length });
    }
    const byId = allGroups.find((group) => url === `/api/admin/groups/${group._id}`);
    if (byId) return json({ group: byId });
    return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) };
  }),
  extractApiError: vi.fn(async (_res: unknown, msg: string) => {
    throw new Error(msg);
  }),
}));

vi.mock('@/hooks/useLocalize', () => ({
  useLocalize: () => (key: string) => key,
}));

interface ChildrenProps {
  children?: ReactNode;
}
interface CommandDialogProps extends ChildrenProps {
  open: boolean;
}
interface CommandItemProps extends ChildrenProps {
  onSelect?: () => void;
}
interface MockButtonProps {
  label: string;
  onClick?: () => void;
}
interface MockIconProps {
  name: string;
}
interface MockSearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  'aria-label'?: string;
}
interface MockPaginationProps {
  currentPage: number;
  totalPages: number;
  onChange: (page: number) => void;
}

vi.mock('cmdk', () => {
  const Passthrough = ({ children }: ChildrenProps) => <div>{children}</div>;
  return {
    Command: Object.assign(Passthrough, {
      Dialog: ({ open, children }: CommandDialogProps) =>
        open ? <div role="dialog">{children}</div> : null,
      Input: () => <input />,
      List: Passthrough,
      Group: Passthrough,
      Item: ({ children, onSelect }: CommandItemProps) => (
        <div onClick={() => onSelect?.()}>{children}</div>
      ),
      Empty: Passthrough,
    }),
  };
});

vi.mock('@clickhouse/click-ui', () => ({
  Button: ({ label, onClick }: MockButtonProps) => (
    <button type="button" onClick={onClick}>
      {label}
    </button>
  ),
  Icon: ({ name }: MockIconProps) => <span data-icon={name} />,
  SearchField: (props: MockSearchFieldProps) => (
    <input
      aria-label={props['aria-label']}
      placeholder={props.placeholder}
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
    />
  ),
  Pagination: ({ currentPage, totalPages, onChange }: MockPaginationProps) => (
    <nav data-testid="pagination" data-current={currentPage} data-total={totalPages}>
      <button type="button" onClick={() => onChange(currentPage + 1)}>
        next-page
      </button>
    </nav>
  ),
}));

vi.mock('@radix-ui/react-visually-hidden', () => ({
  VisuallyHidden: ({ children }: ChildrenProps) => <span hidden>{children}</span>,
}));

vi.mock('@radix-ui/react-dialog', () => ({
  Title: ({ children }: ChildrenProps) => <span>{children}</span>,
  Description: ({ children }: ChildrenProps) => <span>{children}</span>,
}));

import { ScopeSelector } from './ScopeSelector';
import { apiFetch } from '@/server/utils/api';

const mockedApiFetch = vi.mocked(apiFetch);

async function openCreateView() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ScopeSelector
        open
        onOpenChange={() => {}}
        currentSelection={{ type: 'BASE' }}
        onSelect={() => {}}
        permissions={{ canView: true, canEdit: true, canAssign: true }}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByText('com_scope_create'));
}

async function renderCreateView() {
  await openCreateView();
  await screen.findByText('Group 01');
}

beforeEach(() => {
  mockListGate.promise = null;
  mockListFail.fail = false;
  mockedApiFetch.mockClear();
});

describe('ScopeSelector create view group pagination', () => {
  it('renders a fully configured page as disabled entries instead of a global empty state', async () => {
    await renderCreateView();

    expect(screen.queryByText('com_access_groups_empty')).toBeNull();
    expect(screen.queryByText('com_scope_no_matching_groups')).toBeNull();

    const configuredButton = screen.getByText('Group 01').closest('button');
    expect(configuredButton).toBeDisabled();
    expect(screen.getAllByText('com_scope_already_configured')).toHaveLength(PAGE_SIZE);
  });

  it('keeps pagination truthful so eligible groups on later pages stay reachable', async () => {
    await renderCreateView();

    const pagination = screen.getByTestId('pagination');
    expect(pagination.dataset.total).toBe('2');

    fireEvent.click(screen.getByText('next-page'));

    const eligibleButton = (await screen.findByText('Group 51')).closest('button');
    expect(eligibleButton).toBeEnabled();
    expect(screen.queryByText('com_scope_already_configured')).toBeNull();
  });

  it('disables stale rows while a new page or search is being fetched', async () => {
    await renderCreateView();

    fireEvent.click(screen.getByText('next-page'));
    const eligibleButton = (await screen.findByText('Group 51')).closest('button');
    expect(eligibleButton).toBeEnabled();

    let release = () => {};
    mockListGate.promise = new Promise((resolve) => {
      release = resolve;
    });
    fireEvent.change(screen.getByLabelText('com_access_search_groups'), {
      target: { value: 'Group 01' },
    });

    await waitFor(() => expect(screen.getByText('Group 51').closest('button')).toBeDisabled());

    release();
    mockListGate.promise = null;
    await screen.findByText('Group 01');
    expect(screen.queryByText('Group 51')).toBeNull();
    expect(screen.getByText('Group 01').closest('button')).toBeDisabled();
    expect(screen.getByText('com_scope_already_configured')).toBeInTheDocument();
  });

  it('disables rows during the debounce window before the search request starts', async () => {
    await renderCreateView();

    fireEvent.click(screen.getByText('next-page'));
    const eligibleButton = (await screen.findByText('Group 51')).closest('button');
    expect(eligibleButton).toBeEnabled();

    fireEvent.change(screen.getByLabelText('com_access_search_groups'), {
      target: { value: 'Needle' },
    });

    expect(screen.getByText('Group 51').closest('button')).toBeDisabled();
  });

  it('ignores pagination clicks while a search request is in flight', async () => {
    await renderCreateView();
    expect(screen.getByTestId('pagination')).toBeInTheDocument();

    let release = () => {};
    mockListGate.promise = new Promise((resolve) => {
      release = resolve;
    });
    fireEvent.change(screen.getByLabelText('com_access_search_groups'), {
      target: { value: 'Group 01' },
    });
    await waitFor(() =>
      expect(mockedApiFetch.mock.calls.some(([url]) => url.includes('search='))).toBe(true),
    );

    fireEvent.click(screen.getByText('next-page'));

    release();
    mockListGate.promise = null;
    await screen.findByText('com_scope_already_configured');
    expect(screen.getByText('Group 01').closest('button')).toBeInTheDocument();
    expect(screen.queryByText('com_scope_no_matching_groups')).toBeNull();
    expect(screen.queryByTestId('pagination')).toBeNull();

    const strandedUrls = mockedApiFetch.mock.calls
      .map(([url]) => url)
      .filter((url) => url.includes('search=') && url.includes('offset=50'));
    expect(strandedUrls).toEqual([]);
  });

  it('renders a retryable error state instead of an empty list when the fetch fails', async () => {
    mockListFail.fail = true;
    await openCreateView();

    await screen.findByText('com_error_load_groups');
    expect(screen.queryByText('com_access_groups_empty')).toBeNull();
    expect(screen.queryByText('com_scope_no_matching_groups')).toBeNull();
    expect(screen.queryByTestId('pagination')).toBeNull();

    mockListFail.fail = false;
    fireEvent.click(screen.getByText('com_ui_retry'));

    await screen.findByText('Group 01');
    expect(screen.queryByText('com_error_load_groups')).toBeNull();
  });

  it('reopening the create view after a search starts from page 1 unfiltered', async () => {
    await renderCreateView();

    fireEvent.change(screen.getByLabelText('com_access_search_groups'), {
      target: { value: 'Group 51' },
    });
    await screen.findByText('Group 51');
    expect(screen.queryByText('Group 01')).toBeNull();

    fireEvent.click(screen.getByLabelText('com_scope_create_back'));
    const callsAfterBack = mockedApiFetch.mock.calls.length;
    fireEvent.click(screen.getByText('com_scope_create'));

    await screen.findByText('Group 01');
    expect(screen.getByLabelText('com_access_search_groups')).toHaveValue('');
    expect(screen.queryByText('Group 51')).toBeNull();

    const staleUrls = mockedApiFetch.mock.calls
      .slice(callsAfterBack)
      .map(([url]) => url)
      .filter((url) => url.includes('search='));
    expect(staleUrls).toEqual([]);
  });
});
