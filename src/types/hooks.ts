import type { AdminGroup } from '@librechat/data-schemas';
import type { UseMutationResult } from '@tanstack/react-query';
import type { PrincipalType } from 'librechat-data-provider';

export interface CommandItem {
  id: string;
  label: string;
  keywords: string[];
  category: 'config-section';
  tab?: string;
}

export type LocalizeFn = (key: string, options?: Record<string, string | number>) => string;

export type TranslationKeys = string;

export interface UseProfileMutationsOptions {
  fieldPath: string;
  onProfileChange?: () => void;
}

export interface UseProfileMutationsReturn {
  saveMutation: UseMutationResult<
    { success: boolean },
    Error,
    { principalType: PrincipalType; principalId: string; value: unknown }
  >;
  removeMutation: UseMutationResult<
    { success: boolean },
    Error,
    { principalType: PrincipalType; principalId: string }
  >;
  saving: boolean;
}

export interface GroupSearch {
  readonly search: string;
  readonly onSearchChange: (next: string) => void;
  /** Synchronously clear the search input, debounced value, and page. */
  readonly reset: () => void;
  readonly groups: AdminGroup[];
  readonly total: number;
  readonly totalPages: number;
  readonly page: number;
  readonly setPage: (page: number) => void;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly refetch: () => void;
  /** True while the typed search has not yet been committed by the debounce. */
  readonly isSearchPending: boolean;
}

export interface ReorderVoiceover {
  item: (position: number) => string;
  lifted: (position: number) => string;
  moved: (position: number, up: boolean) => string;
  dropped: (from: number, to: number) => string;
  canceled: (position: number) => string;
}
