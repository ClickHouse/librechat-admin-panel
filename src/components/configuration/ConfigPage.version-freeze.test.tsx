import { createToast } from '@clickhouse/click-ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

/**
 * ConfigPage freezes `frozenBaseVersion` from the ['baseConfig'] query and
 * sends it as `expectedVersion` on every mutating action, so a stale admin's
 * request 409s instead of silently overwriting a newer save. That freeze is
 * only re-synced while there are no pending field edits (touchedPaths.size
 * === 0) — but Reset, Import, and Restore are reachable in exactly that
 * state (they're disabled while dirty), so without an additional guard a
 * background refetch (30s staleTime elapsing, a window-focus refetch, an
 * unrelated Langfuse save invalidating the same document) landing WHILE one
 * of their dialogs is open would silently re-freeze a newer version, and the
 * admin's eventual confirm would succeed against that version instead of the
 * one they actually reviewed when they opened the dialog.
 */

const mockNavigate = vi.fn();
const mockUseNavigate = vi.fn(() => mockNavigate);
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    getRouteApi: (id: string) => {
      if (id === '/_app/configuration/') {
        return { useLoaderData: () => ({ tree: [] }) };
      }
      if (id === '/_app') {
        return { useRouteContext: () => ({ user: { id: 'admin-1', tenantId: 'tenant-1' } }) };
      }
      return actual.getRouteApi(id as never);
    },
    useBlocker: vi.fn(),
    useNavigate: mockUseNavigate,
  };
});

vi.mock('@/hooks', async () => ({
  useConfigSession: (
    await vi.importActual<typeof import('@/hooks/useConfigSession')>('@/hooks/useConfigSession')
  ).useConfigSession,
  useLocalize: () => (key: string) => key,
  useHighlightRef: () => () => {},
  useActiveSection: () => () => {},
  useCapabilities: () => ({
    capabilities: [],
    hasCapability: () => true,
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/components/configuration/ScopeSelector', () => ({
  ScopeSelector: () => null,
  ScopeTriggerButton: () => null,
}));

const mockResetBaseConfigFn = vi.fn().mockResolvedValue({ success: true });
const mockGetBaseConfigFn = vi.fn();
const mockConfigTabContent = vi.fn<(props: import('@/types').ConfigTabContentProps) => void>();
const TENANT_BASE_QUERY_KEY = ['baseConfig', 'tenant-1'] as const;
const OTHER_TENANT_BASE_QUERY_KEY = ['baseConfig', 'tenant-2'] as const;

// Observe the real page-to-renderer callbacks without replacing draft logic.
vi.mock('./ConfigTabContent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ConfigTabContent')>();
  return {
    ...actual,
    ConfigTabContent: (props: import('@/types').ConfigTabContentProps) => {
      mockConfigTabContent(props);
      return <actual.ConfigTabContent {...props} />;
    },
  };
});

vi.mock('@/server', () => ({
  baseConfigOptions: {
    queryKey: ['baseConfig'],
    queryFn: () => mockGetBaseConfigFn(),
  },
  getBaseConfigFn: () => mockGetBaseConfigFn(),
  configRevisionsOptions: () => ({
    queryKey: ['configRevisions'],
    queryFn: () => Promise.resolve({ revisions: [] }),
  }),
  availableScopesOptions: (tenantId: string) => ({
    queryKey: ['availableScopes', tenantId],
    queryFn: () => Promise.resolve([]),
  }),
  getResolvedConfigFn: vi.fn(),
  getBatchFieldProfilesFn: vi.fn(),
  getLangfuseConnectionFn: vi.fn(),
  LANGFUSE_CONNECTION_QUERY_KEY: ['adminLangfuseConnection'],
  resetBaseConfigFn: (...args: unknown[]) => mockResetBaseConfigFn(...args),
  setBaseConfigActiveFn: vi.fn(),
  importBaseConfigFn: vi.fn(),
  restoreConfigRevisionFn: vi.fn(),
  saveBaseConfigFn: vi.fn(),
  removeFieldProfileValueFn: vi.fn(),
  tombstoneFieldProfileValueFn: vi.fn(),
  bulkSaveProfileValuesFn: vi.fn(),
  createGroupFn: vi.fn(),
  createRoleFn: vi.fn(),
  parseImportedYaml: vi.fn(),
}));

interface MockButtonProps {
  label?: string;
  onClick?: () => void;
  disabled?: boolean;
}

vi.mock('@clickhouse/click-ui', () => ({
  createToast: vi.fn(),
  Icon: () => null,
  Button: ({ label, onClick, disabled }: MockButtonProps) => (
    <button onClick={onClick} disabled={disabled}>
      {label}
    </button>
  ),
  Badge: ({ text }: { text: string }) => <span>{text}</span>,
  Alert: ({ children }: { children?: React.ReactNode }) => <div role="alert">{children}</div>,
  Dialog: Object.assign(
    ({ open, children }: { open: boolean; children: React.ReactNode }) =>
      open ? <div role="dialog">{children}</div> : null,
    {
      Content: ({ title, children }: { title: string; children: React.ReactNode }) => (
        <>
          <h2>{title}</h2>
          {children}
        </>
      ),
    },
  ),
  Tabs: Object.assign(({ children }: { children?: React.ReactNode }) => <div>{children}</div>, {
    TriggersList: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    Trigger: ({ children }: { children?: React.ReactNode }) => <button>{children}</button>,
  }),
  MultiAccordion: Object.assign(
    ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    { Item: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> },
  ),
}));

// ConfigPage's Header* portal target: rendered by src/components/Header.tsx
// in the real app, which ConfigPage never mounts itself — without this div,
// the Reset/Import/History buttons never appear at all.
function ensureHeaderPortalTarget() {
  if (!document.getElementById('header-actions-portal')) {
    const portal = document.createElement('div');
    portal.id = 'header-actions-portal';
    document.body.appendChild(portal);
  }
}

function ensureLocalStorage() {
  if (typeof window.localStorage !== 'undefined') return;
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  });
}

async function renderConfigPage(dbConfigVersion: number) {
  ensureHeaderPortalTarget();
  ensureLocalStorage();
  mockGetBaseConfigFn.mockResolvedValue({
    config: {},
    dbOverrides: { 'interface.modelSelect': true },
    dbConfigVersion,
    dbIsActive: true,
    effectiveTenantId: 'tenant-1',
    configuredFromBase: [],
    schemaDefaults: {},
    yamlMcpKeys: undefined,
    yamlMcpServers: undefined,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { ConfigPage } = await import('./ConfigPage');
  render(
    <QueryClientProvider client={queryClient}>
      <ConfigPage />
    </QueryClientProvider>,
  );
  return { queryClient };
}

describe('ConfigPage — frozen version protection for destructive actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureLocalStorage();
    window.localStorage.clear();
    mockResetBaseConfigFn.mockResolvedValue({ success: true });
  });

  it('resetting a parent drops child edits from both the draft and touched paths', async () => {
    await renderConfigPage(5);
    await screen.findByRole('button', { name: 'com_config_reset_base' });
    const parent = 'speech.speechTab.textToSpeech';
    await act(async () => {
      mockConfigTabContent.mock.lastCall![0].onFieldChange(`${parent}.voice`, 'nova');
    });
    expect(mockConfigTabContent.mock.lastCall![0].editedValues).toEqual({
      [`${parent}.voice`]: 'nova',
    });
    await act(async () => {
      mockConfigTabContent.mock.lastCall![0].onResetField!(parent);
    });
    const props = mockConfigTabContent.mock.lastCall![0];
    expect(props.editedValues).toEqual({ [parent]: undefined });
    expect(props.touchedPaths).toEqual(new Set([parent]));
  });

  it('blocks a descendant edit after a parent reset and explains how to proceed', async () => {
    await renderConfigPage(5);
    await screen.findByRole('button', { name: 'com_config_reset_base' });
    const parent = 'speech.speechTab.textToSpeech';
    await act(async () => {
      mockConfigTabContent.mock.lastCall![0].onResetField!(parent);
    });
    await act(async () => {
      mockConfigTabContent.mock.lastCall![0].onFieldChange(`${parent}.voice`, 'nova');
    });
    const props = mockConfigTabContent.mock.lastCall![0];
    expect(props.editedValues).toEqual({ [parent]: undefined });
    expect(props.touchedPaths).toEqual(new Set([parent]));
    expect(createToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'com_config_reset_before_edit' }),
    );
  });

  it('sends the version captured when Reset opened, not a version that arrived via a background refetch while the dialog was open', async () => {
    const { queryClient } = await renderConfigPage(5);

    const resetButton = await screen.findByRole('button', { name: 'com_config_reset_base' });
    fireEvent.click(resetButton);
    await screen.findByRole('dialog');

    // Simulate Admin B's save landing and Admin A's query refetching while
    // the Reset dialog is still open (window focus, staleTime elapsing, or
    // an unrelated Langfuse save invalidating the same shared document).
    await act(async () => {
      queryClient.setQueryData(
        TENANT_BASE_QUERY_KEY,
        (old: { dbConfigVersion: number } | undefined) =>
          old ? { ...old, dbConfigVersion: 6 } : old,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const confirmButton = screen.getByRole('button', { name: 'com_config_reset_base_action' });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(mockResetBaseConfigFn).toHaveBeenCalledTimes(1));
    expect(mockResetBaseConfigFn).toHaveBeenCalledWith({
      data: { expectedVersion: 5, expectedTenantId: 'tenant-1' },
    });
  });

  it('picks up a version change that happens BEFORE the dialog opens (freeze only applies once open)', async () => {
    const { queryClient } = await renderConfigPage(5);
    await screen.findByRole('button', { name: 'com_config_reset_base' });

    // Unlike the previous test, this update happens while nothing is open —
    // the resync effect should still be live and adopt it.
    await act(async () => {
      queryClient.setQueryData(
        TENANT_BASE_QUERY_KEY,
        (old: { dbConfigVersion: number } | undefined) =>
          old ? { ...old, dbConfigVersion: 7 } : old,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    fireEvent.click(screen.getByRole('button', { name: 'com_config_reset_base' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'com_config_reset_base_action' }));

    await waitFor(() => expect(mockResetBaseConfigFn).toHaveBeenCalledTimes(1));
    expect(mockResetBaseConfigFn).toHaveBeenCalledWith({
      data: { expectedVersion: 7, expectedTenantId: 'tenant-1' },
    });
  });

  it('closes a destructive dialog instead of carrying an equal-version action into another tenant', async () => {
    window.localStorage.setItem('config:lastScope', 'role:tenant-a-scope');
    const { queryClient } = await renderConfigPage(5);
    fireEvent.click(await screen.findByRole('button', { name: 'com_config_reset_base' }));
    await screen.findByRole('dialog');

    const tenantTwo = {
      config: {},
      dbOverrides: { 'interface.modelSelect': false },
      dbConfigVersion: 5,
      dbIsActive: true,
      effectiveTenantId: 'tenant-2',
      configuredFromBase: [],
      schemaDefaults: {},
      yamlMcpKeys: undefined,
      yamlMcpServers: undefined,
    };
    mockGetBaseConfigFn.mockResolvedValue(tenantTwo);
    await act(async () => {
      queryClient.setQueryData(TENANT_BASE_QUERY_KEY, tenantTwo);
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockResetBaseConfigFn).not.toHaveBeenCalled();
    expect(vi.mocked(createToast)).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'danger' }),
    );
    await waitFor(() =>
      expect(queryClient.getQueryData(OTHER_TENANT_BASE_QUERY_KEY)).toEqual(tenantTwo),
    );
    expect(queryClient.getQueryData(TENANT_BASE_QUERY_KEY)).toBeUndefined();
    expect(window.localStorage.getItem('config:lastScope')).toBeNull();
    const tenantResetNavigation = mockNavigate.mock.calls.find(([options]) => {
      if (typeof options?.search !== 'function') return false;
      return options.search({ scope: 'role:tenant-a-scope' }).scope === undefined;
    });
    expect(tenantResetNavigation).toBeDefined();
  });

  it('re-homes tenant discovery responses without poisoning cache keys across A-to-B-to-A', async () => {
    const { queryClient } = await renderConfigPage(5);
    await screen.findByRole('button', { name: 'com_config_reset_base' });

    const tenantTwo = {
      config: { marker: 'tenant-two' },
      dbOverrides: {},
      dbConfigVersion: 1,
      dbIsActive: true,
      effectiveTenantId: 'tenant-2',
      configuredFromBase: [],
      schemaDefaults: {},
      yamlMcpKeys: undefined,
      yamlMcpServers: undefined,
    };
    mockGetBaseConfigFn.mockResolvedValueOnce(tenantTwo);
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: TENANT_BASE_QUERY_KEY, exact: true });
    });
    await waitFor(() =>
      expect(queryClient.getQueryData(OTHER_TENANT_BASE_QUERY_KEY)).toEqual(tenantTwo),
    );
    expect(queryClient.getQueryData(TENANT_BASE_QUERY_KEY)).toBeUndefined();

    const tenantOne = {
      ...tenantTwo,
      config: { marker: 'tenant-one' },
      dbConfigVersion: 6,
      effectiveTenantId: 'tenant-1',
    };
    mockGetBaseConfigFn.mockResolvedValueOnce(tenantOne);
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: OTHER_TENANT_BASE_QUERY_KEY, exact: true });
    });

    await waitFor(() => expect(queryClient.getQueryData(TENANT_BASE_QUERY_KEY)).toEqual(tenantOne));
    expect(queryClient.getQueryData(OTHER_TENANT_BASE_QUERY_KEY)).toBeUndefined();
    expect(queryClient.getQueryCache().findAll({ queryKey: ['baseConfig'] })).toHaveLength(1);
  });

  it('does not let an older tracked result regress the base-config cache', async () => {
    const { queryClient } = await renderConfigPage(10);
    await screen.findByRole('button', { name: 'com_config_reset_base' });
    const current = queryClient.getQueryData<{
      config: object;
      dbOverrides: object;
      dbConfigVersion: number;
    }>(TENANT_BASE_QUERY_KEY);
    expect(current?.dbConfigVersion).toBe(10);

    act(() => {
      queryClient.setQueryData(TENANT_BASE_QUERY_KEY, {
        ...current,
        config: { marker: 'stale' },
        dbConfigVersion: 9,
      });
    });

    expect(queryClient.getQueryData(TENANT_BASE_QUERY_KEY)).toBe(current);
  });

  it('discard closes the dialog that caused the conflict and adopts the fresh version, so a retry does not 409 again', async () => {
    // Reset (like Import and Restore) is only reachable while touchedPaths is
    // empty, so handleDiscardAfterConflict's own dirty-edit clearing never
    // protects it. Before this fix, discard only closed the version-conflict
    // dialog itself — ResetBaseConfigDialog stayed open, and the frozen-
    // version re-sync effect (gated on !hasDestructiveDialogOpen) never fired,
    // so clicking confirm again resent the same stale frozenBaseVersion and
    // 409ed forever.
    await renderConfigPage(5);

    const resetButton = await screen.findByRole('button', { name: 'com_config_reset_base' });
    fireEvent.click(resetButton);
    await screen.findByRole('dialog');

    const conflictError = Object.assign(new Error('Config version conflict'), {
      name: 'ConfigVersionConflictError',
    });
    mockResetBaseConfigFn.mockRejectedValueOnce(conflictError);
    mockGetBaseConfigFn.mockResolvedValueOnce({
      config: {},
      dbOverrides: { 'interface.modelSelect': true },
      dbConfigVersion: 6,
      dbIsActive: true,
      effectiveTenantId: 'tenant-1',
      configuredFromBase: [],
      schemaDefaults: {},
      yamlMcpKeys: undefined,
      yamlMcpServers: undefined,
    });

    fireEvent.click(screen.getByRole('button', { name: 'com_config_reset_base_action' }));
    await waitFor(() => expect(mockResetBaseConfigFn).toHaveBeenCalledTimes(1));
    await screen.findByRole('button', { name: 'com_config_version_conflict_discard' });
    // The version-conflict dialog and the Reset dialog that triggered it are both open.
    expect(screen.getAllByRole('dialog')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'com_config_version_conflict_discard' }));

    await waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(0));

    // Retrying Reset must use the freshly adopted version, not 409 again on
    // the same stale one.
    mockResetBaseConfigFn.mockResolvedValueOnce({ success: true });
    fireEvent.click(screen.getByRole('button', { name: 'com_config_reset_base' }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'com_config_reset_base_action' }));

    await waitFor(() => expect(mockResetBaseConfigFn).toHaveBeenCalledTimes(2));
    expect(mockResetBaseConfigFn).toHaveBeenLastCalledWith({
      data: { expectedVersion: 6, expectedTenantId: 'tenant-1' },
    });
  });

  it('discard surfaces an error and leaves both dialogs open when the fresh-base fetch fails', async () => {
    // Before this fix, handleDiscardAfterConflict's try/finally had no catch:
    // a rejection from the fresh-base fetch left the async click handler's
    // promise rejecting silently, with no notification and both dialogs
    // (and discardingConflict) stuck exactly where they were.
    await renderConfigPage(5);

    const resetButton = await screen.findByRole('button', { name: 'com_config_reset_base' });
    fireEvent.click(resetButton);
    await screen.findByRole('dialog');

    const conflictError = Object.assign(new Error('Config version conflict'), {
      name: 'ConfigVersionConflictError',
    });
    mockResetBaseConfigFn.mockRejectedValueOnce(conflictError);

    fireEvent.click(screen.getByRole('button', { name: 'com_config_reset_base_action' }));
    await waitFor(() => expect(mockResetBaseConfigFn).toHaveBeenCalledTimes(1));
    await screen.findByRole('button', { name: 'com_config_version_conflict_discard' });

    mockGetBaseConfigFn.mockRejectedValueOnce(new Error('network blip'));

    fireEvent.click(screen.getByRole('button', { name: 'com_config_version_conflict_discard' }));

    await waitFor(() =>
      expect(vi.mocked(createToast)).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'danger' }),
      ),
    );
    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    expect(
      screen.getByRole('button', { name: 'com_config_version_conflict_discard' }),
    ).toBeEnabled();
  });

  it('discard resolves with its own independent call even while a same-key fetchQuery is still in flight', async () => {
    // React Query's fetchQuery joins an already-in-flight request for the
    // same key regardless of staleTime, so a discard implemented on top of
    // fetchQuery (instead of calling getBaseConfigFn directly) could adopt
    // whatever a still-pending, pre-conflict background refetch eventually
    // resolves with -- stale content and version reinstalled right after
    // the admin was told the conflict was resolved.
    const { queryClient } = await renderConfigPage(5);

    const resetButton = await screen.findByRole('button', { name: 'com_config_reset_base' });
    fireEvent.click(resetButton);
    await screen.findByRole('dialog');

    const conflictError = Object.assign(new Error('Config version conflict'), {
      name: 'ConfigVersionConflictError',
    });
    mockResetBaseConfigFn.mockRejectedValueOnce(conflictError);

    fireEvent.click(screen.getByRole('button', { name: 'com_config_reset_base_action' }));
    await waitFor(() => expect(mockResetBaseConfigFn).toHaveBeenCalledTimes(1));
    await screen.findByRole('button', { name: 'com_config_version_conflict_discard' });

    // A same-key fetchQuery is still pending when discard is triggered.
    let resolvePendingFetch:
      | ((value: { config: object; dbConfigVersion: number }) => void)
      | undefined;
    mockGetBaseConfigFn.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePendingFetch = resolve;
      }),
    );
    const staleInFlight = queryClient.fetchQuery({
      queryKey: TENANT_BASE_QUERY_KEY,
      queryFn: () => mockGetBaseConfigFn(),
    });
    mockGetBaseConfigFn.mockResolvedValueOnce({
      config: {},
      dbOverrides: { 'interface.modelSelect': true },
      dbConfigVersion: 9,
      dbIsActive: true,
      effectiveTenantId: 'tenant-1',
      configuredFromBase: [],
      schemaDefaults: {},
      yamlMcpKeys: undefined,
      yamlMcpServers: undefined,
    });

    fireEvent.click(screen.getByRole('button', { name: 'com_config_version_conflict_discard' }));

    await waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(0));
    // Discard adopted version 9 from its own direct call, not the version-5
    // response the still-pending fetchQuery above will eventually resolve with.
    expect(
      (queryClient.getQueryData(TENANT_BASE_QUERY_KEY) as { dbConfigVersion: number })
        .dbConfigVersion,
    ).toBe(9);

    // Settling the stale in-flight fetch afterward must not silently revert
    // the cache: calling getBaseConfigFn directly stops discard from
    // *adopting* a stale in-flight response, but does nothing on its own to
    // stop that older request from resolving later and overwriting what was
    // just installed -- only cancelling it first does that.
    await act(async () => {
      resolvePendingFetch?.({
        config: {},
        dbConfigVersion: 5,
        effectiveTenantId: 'tenant-1',
      } as never);
      await staleInFlight.catch(() => undefined);
    });
    expect(
      (queryClient.getQueryData(TENANT_BASE_QUERY_KEY) as { dbConfigVersion: number })
        .dbConfigVersion,
    ).toBe(9);
  });

  it('does not let a tracked fetch that starts during the direct read get wrongly cancelled', async () => {
    // Cancelling AFTER the direct read (instead of before) would discard a
    // tracked fetch that starts while that read is still in flight -- even
    // when that fetch resolves with a genuinely newer version than the
    // direct read's own result. Cancelling first means such a fetch was
    // never tracked at cancel-time, so it survives to land afterward.
    const { queryClient } = await renderConfigPage(5);

    const resetButton = await screen.findByRole('button', { name: 'com_config_reset_base' });
    fireEvent.click(resetButton);
    await screen.findByRole('dialog');

    const conflictError = Object.assign(new Error('Config version conflict'), {
      name: 'ConfigVersionConflictError',
    });
    mockResetBaseConfigFn.mockRejectedValueOnce(conflictError);
    fireEvent.click(screen.getByRole('button', { name: 'com_config_reset_base_action' }));
    await waitFor(() => expect(mockResetBaseConfigFn).toHaveBeenCalledTimes(1));
    await screen.findByRole('button', { name: 'com_config_version_conflict_discard' });

    // Discard's own direct read is held pending.
    let resolveDiscardRead:
      | ((value: { config: object; dbConfigVersion: number }) => void)
      | undefined;
    mockGetBaseConfigFn.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDiscardRead = resolve;
      }),
    );
    const callsBeforeDiscard = mockGetBaseConfigFn.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'com_config_version_conflict_discard' }));
    // Waits for discard's own getBaseConfigFn() call to actually fire, which
    // -- with cancelQueries positioned before it -- only happens once that
    // cancellation has already completed.
    await waitFor(() => expect(mockGetBaseConfigFn.mock.calls.length).toBe(callsBeforeDiscard + 1));

    // A tracked fetch starts WHILE discard's own read is still pending -- an
    // unrelated background refetch firing at the same moment. It will
    // resolve with a genuinely newer version than discard's own read.
    let resolveTrackedFetch:
      | ((value: { config: object; dbConfigVersion: number }) => void)
      | undefined;
    mockGetBaseConfigFn.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveTrackedFetch = resolve;
      }),
    );
    const trackedFetch = queryClient.fetchQuery({
      queryKey: TENANT_BASE_QUERY_KEY,
      queryFn: () => mockGetBaseConfigFn(),
    });
    await waitFor(() => expect(mockGetBaseConfigFn.mock.calls.length).toBe(callsBeforeDiscard + 2));

    // Discard's own read resolves with an OLDER version than the tracked
    // fetch above will.
    await act(async () => {
      resolveDiscardRead?.({
        config: {},
        dbOverrides: {},
        dbConfigVersion: 9,
        dbIsActive: true,
        effectiveTenantId: 'tenant-1',
        configuredFromBase: [],
        schemaDefaults: {},
        yamlMcpKeys: undefined,
        yamlMcpServers: undefined,
      } as never);
    });
    await waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(0));

    // The tracked fetch, never cancelled, is free to land afterward and win
    // on version.
    await act(async () => {
      resolveTrackedFetch?.({
        config: {},
        dbOverrides: {},
        dbConfigVersion: 12,
        dbIsActive: true,
        effectiveTenantId: 'tenant-1',
        configuredFromBase: [],
        schemaDefaults: {},
        yamlMcpKeys: undefined,
        yamlMcpServers: undefined,
      } as never);
      await trackedFetch;
    });

    expect(
      (queryClient.getQueryData(TENANT_BASE_QUERY_KEY) as { dbConfigVersion: number })
        .dbConfigVersion,
    ).toBe(12);
  });
});
