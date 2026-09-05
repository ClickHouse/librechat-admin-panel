import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useConfigSession } from './useConfigSession';

const initial = { version: 3, tenantId: 'tenant-a', value: { cache: true } };

describe('useConfigSession', () => {
  it('keeps draft changes separate from the frozen baseline', () => {
    const { result, rerender } = renderHook(
      ({ baseline }) => useConfigSession(baseline, { cache: true }),
      { initialProps: { baseline: initial } },
    );
    act(() => result.current.setDraft({ cache: false }));
    rerender({ baseline: { ...initial, version: 4 } });
    expect(result.current.baseline).toEqual(initial);
    expect(result.current.draft).toEqual({ cache: false });
    act(() => result.current.adoptBaseline({ ...initial, version: 4 }));
    expect(result.current.baseline.version).toBe(4);
    expect(result.current.draft).toEqual({ cache: false });
  });

  it('adopts version, tenant, and content together without regressing within a tenant', () => {
    const { result } = renderHook(() => useConfigSession(initial, {}));
    act(() =>
      result.current.adoptBaseline({ version: 2, tenantId: 'tenant-a', value: { cache: false } }),
    );
    expect(result.current.baseline).toEqual(initial);
    act(() =>
      result.current.adoptBaseline({
        version: null,
        tenantId: 'tenant-a',
        value: { cache: false },
      }),
    );
    expect(result.current.baseline).toEqual(initial);
    const otherTenant = { version: 1, tenantId: 'tenant-b', value: { cache: false } };
    act(() => result.current.adoptBaseline(otherTenant));
    expect(result.current.baseline).toEqual(otherTenant);
  });

  it('serializes discard and rebase even when both are invoked before a render', async () => {
    const { result } = renderHook(() => useConfigSession(initial, {}));
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const competing = vi.fn();
    act(() => result.current.setConflictOpen(true));
    let first!: Promise<void>;
    act(() => {
      first = result.current.resolveConflict('rebase', () => pending);
      void result.current.resolveConflict('discard', competing);
    });
    expect(result.current.rebasing).toBe(true);
    expect(result.current.discarding).toBe(false);
    expect(competing).not.toHaveBeenCalled();
    await act(async () => {
      finish();
      await first;
    });
    expect(result.current.conflictOpen).toBe(false);
    expect(result.current.rebasing).toBe(false);
  });

  it('keeps a failed conflict resolution open and permits a retry', async () => {
    const { result } = renderHook(() => useConfigSession(initial, { cache: false }));
    act(() => result.current.setConflictOpen(true));
    await act(async () => {
      await expect(
        result.current.resolveConflict('discard', async () => {
          throw 'Read failed';
        }),
      ).rejects.toThrow('Read failed');
    });
    expect(result.current.conflictOpen).toBe(true);
    expect(result.current.discarding).toBe(false);
    expect(result.current.draft).toEqual({ cache: false });
    await act(async () => {
      await result.current.resolveConflict('discard', async () => {});
    });
    expect(result.current.conflictOpen).toBe(false);
  });
});
