import { useCallback, useRef, useState } from 'react';
import type * as t from '@/types';

export function useConfigSession<TBaseline, TDraft extends object>(
  initialBaseline: t.ConfigEditBaseline<TBaseline>,
  initialDraft: TDraft,
) {
  const [baseline, setBaseline] = useState(initialBaseline);
  const [draft, setDraft] = useState(initialDraft);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [resolution, setResolution] = useState<t.ConfigConflictAction | null>(null);
  const resolving = useRef(false);

  const adoptBaseline = useCallback((next: t.ConfigEditBaseline<TBaseline>) => {
    setBaseline((current) => {
      if (
        current.tenantId === next.tenantId &&
        current.version != null &&
        (next.version == null || next.version < current.version)
      ) {
        return current;
      }
      return next;
    });
  }, []);

  const resolveConflict = useCallback(
    async (action: t.ConfigConflictAction, resolve: () => Promise<void>) => {
      if (resolving.current) return;
      resolving.current = true;
      setResolution(action);
      try {
        await resolve();
        setConflictOpen(false);
      } catch (error) {
        throw error instanceof Error ? error : new Error(String(error));
      } finally {
        resolving.current = false;
        setResolution(null);
      }
    },
    [],
  );

  return {
    baseline,
    adoptBaseline,
    draft,
    setDraft,
    conflictOpen,
    setConflictOpen,
    resolveConflict,
    rebasing: resolution === 'rebase',
    discarding: resolution === 'discard',
  };
}
