import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const allGroups = [
  { _id: 'grp-a', name: 'Group A', memberIds: [], source: 'entra' },
  { _id: 'grp-b', name: 'Group B', memberIds: [], source: 'entra' },
];

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
    if (url.startsWith('/api/admin/groups?')) {
      const params = new URLSearchParams(url.split('?')[1]);
      const search = params.get('search')?.toLowerCase() ?? '';
      const matches = search
        ? allGroups.filter((group) => group.name.toLowerCase().includes(search))
        : allGroups;
      return {
        ok: true,
        status: 200,
        json: async () => ({ groups: matches, total: matches.length }),
      };
    }
    return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) };
  }),
  extractApiError: vi.fn(async (_res: unknown, msg: string) => {
    throw new Error(msg);
  }),
}));

vi.mock('@/hooks/useLocalize', () => ({
  useLocalize: () => (key: string) => key,
}));

vi.mock('@/hooks/useCapabilities', () => ({
  useCapabilities: () => ({ hasCapability: () => true }),
}));

vi.mock('./EditGroupDialog', () => ({ EditGroupDialog: () => null }));
vi.mock('./ConfirmDialog', () => ({ ConfirmDialog: () => null }));

interface MockButtonProps {
  label: string;
  onClick?: () => void;
}
interface MockSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

vi.mock('@clickhouse/click-ui', () => ({
  createToast: vi.fn(),
  Button: ({ label, onClick }: MockButtonProps) => (
    <button type="button" onClick={onClick}>
      {label}
    </button>
  ),
}));

vi.mock('@/components/shared', () => ({
  LoadingState: () => <div>loading</div>,
  SearchInput: ({ value, onChange, placeholder }: MockSearchInputProps) => (
    <input
      aria-label="group-search"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
  EmptyState: ({ message }: { message: string }) => <div>{message}</div>,
  Pagination: () => null,
  TrashButton: () => null,
}));

import { GroupsTab } from './GroupsTab';
import { apiFetch } from '@/server/utils/api';

const mockedApiFetch = vi.mocked(apiFetch);

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(<GroupsTab onCreateGroup={() => {}} />, { wrapper });
}

describe('GroupsTab search clamping', () => {
  it('clamps the search input to the backend limit so displayed and queried text agree', async () => {
    renderTab();
    await screen.findByText('Group A');

    fireEvent.change(screen.getByLabelText('group-search'), {
      target: { value: 'x'.repeat(250) },
    });

    expect(screen.getByLabelText('group-search')).toHaveValue('x'.repeat(200));

    await waitFor(() => {
      const searchUrls = mockedApiFetch.mock.calls
        .map(([url]) => url)
        .filter((url) => url.includes('search='));
      expect(searchUrls).toHaveLength(1);
    });
    const url = mockedApiFetch.mock.calls.map(([u]) => u).find((u) => u.includes('search='));
    const sent = new URLSearchParams(url?.split('?')[1] ?? '').get('search') ?? '';
    expect(sent).toHaveLength(200);
  });
});
