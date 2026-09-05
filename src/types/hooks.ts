import type { UseMutationResult } from '@tanstack/react-query';
import type { PrincipalType } from 'librechat-data-provider';
import type { ReactNode } from 'react';
import type { SerializableUser } from './server';

export interface ConfigEditBaseline<T> {
  version: number | null;
  tenantId: string;
  value: T;
}

export type ConfigConflictAction = 'rebase' | 'discard';

export interface LangfuseConnectionDraft {
  destination: string;
  publicKey: string;
  secretKey: string;
}

export interface CapabilitiesContextValue {
  capabilities: string[];
  effectiveTenantId: string;
  hasCapability: (capability: string) => boolean;
  isLoading: boolean;
  isError: boolean;
}

export interface CapabilitiesProviderProps {
  user: SerializableUser;
  navigationKey: string;
  children: ReactNode;
}

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
  expectedTenantId: string;
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

export interface ReorderVoiceover {
  item: (position: number) => string;
  lifted: (position: number) => string;
  moved: (position: number, up: boolean) => string;
  dropped: (from: number, to: number) => string;
  canceled: (position: number) => string;
}
