import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const TOTAL_GROUPS = 120;

const allGroups = [
  ...Array.from({ length: TOTAL_GROUPS }, (_, i) => ({
    _id: `group-${i + 1}`,
    name: `Group ${i + 1}`,
    memberIds: [],
    source: 'entra',
  })),
  { _id: 'group-needle', name: 'Needle', memberIds: [], source: 'entra' },
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
    const params = new URLSearchParams(url.split('?')[1] ?? '');
    const search = params.get('search')?.toLowerCase() ?? '';
    const limit = Number(params.get('limit') ?? 200);
    const offset = Number(params.get('offset') ?? 0);
    const matches = search
      ? allGroups.filter((group) => group.name.toLowerCase().includes(search))
      : allGroups;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        groups: matches.slice(offset, offset + limit),
        total: matches.length,
      }),
    };
  }),
  extractApiError: vi.fn(async (_res: unknown, msg: string) => {
    throw new Error(msg);
  }),
}));

import { useGroupSearch } from './useGroupSearch';
import { GROUPS_PAGE_SIZE } from '@/server';
import { apiFetch } from '@/server/utils/api';

const mockedApiFetch = vi.mocked(apiFetch);

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  mockedApiFetch.mockClear();
});

describe('useGroupSearch', () => {
  it('fetches the first page with server-side pagination totals', async () => {
    const { result } = renderHook(() => useGroupSearch(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.groups).toHaveLength(GROUPS_PAGE_SIZE);
    expect(result.current.groups[0]?.name).toBe('Group 1');
    expect(result.current.total).toBe(TOTAL_GROUPS + 1);
    expect(result.current.totalPages).toBe(3);
  });

  it('fetches groups beyond the first page when the page changes', async () => {
    const { result } = renderHook(() => useGroupSearch(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setPage(3));

    await waitFor(() => expect(result.current.groups[0]?.name).toBe('Group 101'));
    expect(result.current.page).toBe(3);
    expect(mockedApiFetch).toHaveBeenLastCalledWith(
      `/api/admin/groups?limit=${GROUPS_PAGE_SIZE}&offset=${2 * GROUPS_PAGE_SIZE}`,
    );
  });

  it('debounces search on the server and resets to the first page', async () => {
    const { result } = renderHook(() => useGroupSearch(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setPage(3));
    await waitFor(() => expect(result.current.groups[0]?.name).toBe('Group 101'));

    act(() => result.current.onSearchChange('Need'));
    act(() => result.current.onSearchChange('Needle'));

    await waitFor(() =>
      expect(result.current.groups).toEqual([expect.objectContaining({ name: 'Needle' })]),
    );
    expect(result.current.page).toBe(1);
    expect(result.current.total).toBe(1);

    const searchUrls = mockedApiFetch.mock.calls
      .map(([url]) => url)
      .filter((url) => url.includes('search='));
    expect(searchUrls).toEqual([
      `/api/admin/groups?search=Needle&limit=${GROUPS_PAGE_SIZE}&offset=0`,
    ]);
  });

  it('truncates search strings to the backend limit instead of triggering a 400', async () => {
    const { result } = renderHook(() => useGroupSearch(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.onSearchChange('x'.repeat(250)));

    expect(result.current.search).toHaveLength(200);

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

  it('reset synchronously clears search and page without issuing stale requests', async () => {
    const { result } = renderHook(() => useGroupSearch(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setPage(3));
    await waitFor(() => expect(result.current.groups[0]?.name).toBe('Group 101'));
    act(() => result.current.onSearchChange('Needle'));
    await waitFor(() => expect(result.current.total).toBe(1));

    act(() => result.current.onSearchChange('Nee'));
    const callsBefore = mockedApiFetch.mock.calls.length;
    act(() => result.current.reset());

    expect(result.current.search).toBe('');
    expect(result.current.page).toBe(1);
    await waitFor(() => expect(result.current.groups[0]?.name).toBe('Group 1'));

    await new Promise((resolve) => setTimeout(resolve, 350));
    const staleUrls = mockedApiFetch.mock.calls
      .slice(callsBefore)
      .map(([url]) => url)
      .filter((url) => url.includes('search='));
    expect(staleUrls).toEqual([]);
  });

  it('reports a pending search until the debounce commits', async () => {
    const { result } = renderHook(() => useGroupSearch(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isSearchPending).toBe(false);

    act(() => result.current.onSearchChange('Needle'));
    expect(result.current.isSearchPending).toBe(true);

    await waitFor(() => expect(result.current.isSearchPending).toBe(false));
    expect(result.current.total).toBe(1);
  });

  it('clamps the page back to the last valid page when the total shrinks below it', async () => {
    const { result } = renderHook(() => useGroupSearch(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setPage(10));

    await waitFor(() => expect(result.current.page).toBe(3));
    await waitFor(() => expect(result.current.groups[0]?.name).toBe('Group 101'));
  });

  it('does not fetch until enabled', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useGroupSearch(enabled), {
      wrapper: createWrapper(),
      initialProps: { enabled: false },
    });

    expect(mockedApiFetch).not.toHaveBeenCalled();
    expect(result.current.groups).toEqual([]);

    rerender({ enabled: true });

    await waitFor(() => expect(result.current.groups).toHaveLength(GROUPS_PAGE_SIZE));
  });
});
