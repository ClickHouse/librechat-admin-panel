import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PrincipalType } from 'librechat-data-provider';
import type * as t from '@/types';
import { removeFieldProfileValueFn, saveFieldProfileValueFn } from '@/server';
import { notifySuccess, notifyError } from '@/utils';
import { useLocalize } from './useLocalize';

export function useProfileMutations({
  fieldPath,
  onProfileChange,
}: t.UseProfileMutationsOptions): t.UseProfileMutationsReturn {
  const queryClient = useQueryClient();
  const localize = useLocalize();

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['profileMap'] });
    queryClient.invalidateQueries({ queryKey: ['resolvedConfig'] });
    queryClient.invalidateQueries({ queryKey: ['availableScopes'] });
    onProfileChange?.();
  }, [queryClient, onProfileChange]);

  const saveMutation = useMutation({
    mutationFn: (params: { principalType: PrincipalType; principalId: string; value: unknown }) =>
      saveFieldProfileValueFn({ data: { fieldPath, ...params } }),
    onSuccess: () => {
      invalidate();
      notifySuccess(localize('com_toast_profile_value_saved'));
    },
    onError: (err: Error) => notifyError(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: (params: { principalType: PrincipalType; principalId: string }) =>
      removeFieldProfileValueFn({ data: { fieldPath, ...params } }),
    onSuccess: () => {
      invalidate();
      notifySuccess(localize('com_toast_profile_value_removed'));
    },
    onError: (err: Error) => notifyError(err.message),
  });

  return {
    saveMutation,
    removeMutation,
    saving: saveMutation.isPending || removeMutation.isPending,
  };
}
