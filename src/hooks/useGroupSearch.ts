import { useCallback, useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type * as t from '@/types';
import { groupsQueryOptions, GROUPS_PAGE_SIZE, MAX_SEARCH_LENGTH } from '@/server';
import { useDebouncedFilter } from './useDebouncedFilter';

/** Debounced server-side group search with offset pagination, so consumers
 * can browse every group instead of a single capped page. Searching resets
 * to the first page; previous results are kept while a new page loads. */
export function useGroupSearch(enabled = true): t.GroupSearch {
  const [page, setPage] = useState(1);
  const resetPage = useCallback(() => setPage(1), []);
  const { value, debouncedValue, onChange, reset: resetFilter } = useDebouncedFilter('', resetPage);

  const onSearchChange = useCallback(
    (next: string) => onChange(next.slice(0, MAX_SEARCH_LENGTH)),
    [onChange],
  );

  const reset = useCallback(() => {
    resetFilter();
    setPage(1);
  }, [resetFilter]);

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    ...groupsQueryOptions(page, debouncedValue),
    placeholderData: keepPreviousData,
    enabled,
  });

  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / GROUPS_PAGE_SIZE);

  useEffect(() => {
    if (!data) return;
    const lastPage = Math.max(1, totalPages);
    if (page > lastPage) setPage(lastPage);
  }, [data, page, totalPages]);

  return {
    search: value,
    onSearchChange,
    reset,
    groups: data?.groups ?? [],
    total,
    totalPages,
    page,
    setPage,
    isLoading,
    isFetching,
    isError,
    refetch,
    isSearchPending: value !== debouncedValue,
  };
}
