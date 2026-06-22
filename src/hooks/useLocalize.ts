import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type * as t from '@/types';

export function useLocalize(): (
  phraseKey: t.TranslationKeys,
  options?: Record<string, string | number>,
) => string {
  const { t: translate } = useTranslation();

  return useCallback(
    (phraseKey: t.TranslationKeys, options?: Record<string, string | number>) =>
      translate(phraseKey, options ?? {}),
    [translate],
  );
}
