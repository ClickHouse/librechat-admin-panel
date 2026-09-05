import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as t from '@/types';
import {
  getBaseConfigFn,
  getLangfuseConnectionFn,
  LANGFUSE_CONNECTION_QUERY_KEY,
  testLangfuseConnectionFn,
  updateLangfuseConnectionFn,
} from '@/server';
import { LangfuseRenderer } from '../LangfuseRenderer';

vi.mock('@/hooks', async () => ({
  useConfigSession: (
    await vi.importActual<typeof import('@/hooks/useConfigSession')>('@/hooks/useConfigSession')
  ).useConfigSession,
  useLocalize: () => (key: string) => key,
}));

vi.mock('@/utils', () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
}));

vi.mock('@/server', () => ({
  LANGFUSE_CONNECTION_QUERY_KEY: ['adminLangfuseConnection'],
  baseConfigOptions: { queryKey: ['baseConfig'] },
  getBaseConfigFn: vi.fn(),
  getLangfuseConnectionFn: vi.fn(),
  testLangfuseConnectionFn: vi.fn(),
  updateLangfuseConnectionFn: vi.fn(),
}));

interface TextFieldProps {
  label?: string;
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
}

interface ButtonProps {
  label?: string;
  disabled?: boolean;
  onClick?: () => void;
}

interface SelectProps {
  label?: string;
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  onSelect?: (value: string) => void;
  children?: React.ReactNode;
}

vi.mock('@clickhouse/click-ui', () => ({
  Badge: ({ text }: { text: string }) => <span>{text}</span>,
  Button: ({ label, disabled, onClick }: ButtonProps) => (
    <button disabled={disabled} onClick={onClick}>
      {label}
    </button>
  ),
  Select: Object.assign(
    ({ label, value, placeholder, disabled, onSelect, children }: SelectProps) => (
      <label>
        {label}
        <select
          aria-label={label}
          value={value ?? ''}
          disabled={disabled}
          onChange={(event) => onSelect?.(event.target.value)}
        >
          <option value="">{placeholder}</option>
          {children}
        </select>
      </label>
    ),
    {
      Item: ({ value, children }: { value: string; children: React.ReactNode }) => (
        <option value={value}>{children}</option>
      ),
    },
  ),
  TextField: ({ label, value, placeholder, disabled, onChange }: TextFieldProps) => (
    <input
      aria-label={label || placeholder}
      value={value ?? ''}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
  Icon: () => null,
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
}));

const mockGet = vi.mocked(getLangfuseConnectionFn);
const mockTest = vi.mocked(testLangfuseConnectionFn);
const mockUpdate = vi.mocked(updateLangfuseConnectionFn);
const mockGetBaseConfig = vi.mocked(getBaseConfigFn);

/** Fills in the `baseConfigOptions` result fields these tests don't otherwise care about. */
function makeBaseConfigResult(overrides: {
  config: Record<string, t.ConfigValue>;
  dbConfigVersion: number | null;
}) {
  return {
    dbOverrides: undefined,
    dbIsActive: true,
    effectiveTenantId: 'tenant-1',
    configuredFromBase: [],
    schemaDefaults: {},
    yamlMcpKeys: undefined,
    yamlMcpServers: undefined,
    ...overrides,
  };
}
const destinations = [
  { key: 'eu', baseUrl: 'https://cloud.langfuse.com' },
  { key: 'us', baseUrl: 'https://us.cloud.langfuse.com' },
];
const TENANT_ID = 'tenant-1';
const TENANT_LANGFUSE_QUERY_KEY = [...LANGFUSE_CONNECTION_QUERY_KEY, TENANT_ID] as const;
const TENANT_BASE_QUERY_KEY = ['baseConfig', TENANT_ID] as const;

function renderLangfuse(overrides: Partial<t.FieldRendererProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props: t.FieldRendererProps = {
    fields: [],
    parentValue: {},
    parentPath: 'langfuse',
    getValue: (_path, fallback) => fallback,
    onChange: vi.fn(),
    effectiveTenantId: TENANT_ID,
    ...overrides,
  };
  const result = render(
    <QueryClientProvider client={queryClient}>
      <LangfuseRenderer {...props} />
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({
    configured: false,
    enabled: false,
    configActive: true,
    destinations,
    configVersion: null,
    effectiveTenantId: 'tenant-1',
  });
  mockTest.mockResolvedValue({ success: true });
  mockGetBaseConfig.mockResolvedValue(makeBaseConfigResult({ config: {}, dbConfigVersion: 1 }));
});

describe('LangfuseRenderer', () => {
  it('loads the deployment-approved destinations from LibreChat', async () => {
    renderLangfuse();
    const destination = await screen.findByLabelText('com_config_langfuse_destination');
    expect(destination).toHaveValue('');
    expect(screen.getByRole('option', { name: 'eu - https://cloud.langfuse.com' })).toBeVisible();
    expect(
      screen.getByRole('option', { name: 'us - https://us.cloud.langfuse.com' }),
    ).toBeVisible();
    expect(screen.getByPlaceholderText('pk-lf-...')).toBeVisible();
    expect(screen.getByPlaceholderText('sk-lf-...')).toBeVisible();
    expect(screen.getByRole('button', { name: 'com_ui_cancel' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'com_config_langfuse_save_and_enable' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'com_config_langfuse_enable' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'com_config_langfuse_disable' }),
    ).not.toBeInTheDocument();
  });

  it('loads the connection for the default empty tenant context', async () => {
    mockGet.mockResolvedValue({
      configured: false,
      enabled: false,
      destinations,
      configVersion: null,
      effectiveTenantId: '',
    });

    renderLangfuse({ effectiveTenantId: '' });

    await screen.findByLabelText('com_config_langfuse_destination');
    expect(mockGet).toHaveBeenCalledWith({ data: { expectedTenantId: '' } });
  });

  it('shows masked keys and verifies a configured connection on load', async () => {
    mockGet.mockResolvedValue({
      configured: true,
      enabled: true,
      destinations,
      destination: 'eu',
      publicKey: 'pk-lf-1234567890abcdef',
      displaySecretKey: 'sk-lf-...515f',
      configVersion: 3,
      effectiveTenantId: TENANT_ID,
    });
    renderLangfuse();

    expect(await screen.findByText('pk-lf-...cdef')).toBeVisible();
    expect(screen.getByText('sk-lf-...515f')).toBeVisible();
    await waitFor(() =>
      expect(mockTest).toHaveBeenCalledWith({
        data: {
          destination: 'eu',
          publicKey: 'pk-lf-1234567890abcdef',
          expectedTenantId: TENANT_ID,
        },
      }),
    );
    expect(await screen.findByText('com_config_langfuse_verified')).toBeVisible();
  });

  it('reports an inactive base configuration without testing or enabling it', async () => {
    mockGet.mockResolvedValue({
      configured: true,
      enabled: false,
      configActive: false,
      destinations,
      destination: 'eu',
      publicKey: 'pk-lf-public',
      secretKeyPreview: 'sk-lf-...515f',
      configVersion: 7,
      effectiveTenantId: TENANT_ID,
    });

    renderLangfuse();

    expect(await screen.findByText('com_config_langfuse_inactive')).toBeVisible();
    expect(screen.getByText('com_config_langfuse_config_inactive')).toBeVisible();
    expect(screen.getByRole('button', { name: 'com_config_langfuse_enable' })).toBeDisabled();
    expect(mockTest).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('shows a configured connection as unverified without verifying it for read-only (disabled) viewers', async () => {
    mockGet.mockResolvedValue({
      configured: true,
      enabled: true,
      destinations,
      destination: 'eu',
      publicKey: 'pk-lf-1234567890abcdef',
      displaySecretKey: 'sk-lf-...515f',
      configVersion: 3,
      effectiveTenantId: TENANT_ID,
    });
    renderLangfuse({ disabled: true });

    expect(await screen.findByText('pk-lf-...cdef')).toBeVisible();
    expect(await screen.findByText('com_config_langfuse_not_verified')).toBeVisible();
    expect(screen.queryByText('com_config_langfuse_not_configured')).not.toBeInTheDocument();
    expect(mockTest).not.toHaveBeenCalled();
  });

  it('keeps the disable action available when the stored destination is no longer allowlisted', async () => {
    mockGet.mockResolvedValue({
      configured: true,
      enabled: true,
      destinations,
      destination: 'removed-region',
      publicKey: 'pk-lf-1234567890abcdef',
      displaySecretKey: 'sk-lf-...515f',
      configVersion: 3,
      effectiveTenantId: TENANT_ID,
    });
    renderLangfuse();

    expect(
      await screen.findByRole('button', { name: 'com_config_langfuse_disable' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'com_config_langfuse_save_and_enable' }),
    ).not.toBeInTheDocument();
  });

  it('verifies then saves a new connection through the dedicated API', async () => {
    mockUpdate.mockResolvedValue({
      configured: true,
      enabled: true,
      destinations,
      destination: 'eu',
      publicKey: 'pk-lf-new',
      displaySecretKey: 'sk-lf-...cret',
      configVersion: 1,
      effectiveTenantId: TENANT_ID,
    });
    renderLangfuse();

    fireEvent.change(await screen.findByLabelText('com_config_langfuse_destination'), {
      target: { value: 'eu' },
    });
    fireEvent.change(screen.getByPlaceholderText('pk-lf-...'), {
      target: { value: 'pk-lf-new' },
    });
    fireEvent.change(screen.getByPlaceholderText('sk-lf-...'), {
      target: { value: 'sk-lf-secret' },
    });
    const saveButton = screen.getByRole('button', {
      name: 'com_config_langfuse_save_and_enable',
    });
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    await waitFor(() =>
      expect(mockTest).toHaveBeenLastCalledWith({
        data: {
          destination: 'eu',
          publicKey: 'pk-lf-new',
          secretKey: 'sk-lf-secret',
          expectedTenantId: TENANT_ID,
        },
      }),
    );
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        data: {
          enabled: true,
          destination: 'eu',
          publicKey: 'pk-lf-new',
          secretKey: 'sk-lf-secret',
          expectedVersion: null,
          expectedTenantId: TENANT_ID,
        },
      }),
    );
  });

  it('preserves the stored secret when only the public key is edited', async () => {
    const configuredStatus = {
      configured: true,
      enabled: true,
      destinations,
      destination: 'eu',
      publicKey: 'pk-lf-old',
      displaySecretKey: 'sk-lf-...515f',
      configVersion: 3,
      effectiveTenantId: TENANT_ID,
    };
    mockGet.mockResolvedValue(configuredStatus);
    mockUpdate.mockResolvedValue({ ...configuredStatus, publicKey: 'pk-lf-new' });
    const { queryClient } = renderLangfuse();

    fireEvent.click(
      await screen.findByRole('button', { name: 'com_ui_edit com_config_langfuse_public_key' }),
    );
    expect(screen.getByRole('button', { name: 'com_ui_cancel' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'com_config_langfuse_save_and_enable' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'com_config_langfuse_disable' }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('pk-lf-...'), {
      target: { value: 'pk-lf-new' },
    });
    expect(screen.getByText('com_config_langfuse_not_verified')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'com_config_langfuse_save_and_enable' }));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        data: {
          enabled: true,
          destination: 'eu',
          publicKey: 'pk-lf-new',
          expectedVersion: 3,
          expectedTenantId: TENANT_ID,
        },
      }),
    );
    await waitFor(() =>
      expect(queryClient.getQueryData(TENANT_LANGFUSE_QUERY_KEY)).toEqual({
        ...configuredStatus,
        publicKey: 'pk-lf-new',
      }),
    );
  });

  it('preserves draft fields when shared connection data refreshes', async () => {
    const configuredStatus = {
      configured: true,
      enabled: true,
      destinations,
      destination: 'eu',
      publicKey: 'pk-lf-stored',
      displaySecretKey: 'sk-lf-...515f',
      configVersion: 3,
      effectiveTenantId: TENANT_ID,
    };
    mockGet.mockResolvedValue(configuredStatus);
    const { queryClient } = renderLangfuse();
    expect(await screen.findByText('com_config_langfuse_verified')).toBeVisible();
    expect(mockTest).toHaveBeenCalledTimes(1);

    fireEvent.click(
      await screen.findByRole('button', { name: 'com_ui_edit com_config_langfuse_public_key' }),
    );
    fireEvent.change(screen.getByPlaceholderText('pk-lf-...'), {
      target: { value: 'pk-lf-draft' },
    });

    act(() => {
      queryClient.setQueryData(TENANT_LANGFUSE_QUERY_KEY, {
        ...configuredStatus,
        destination: 'us',
        publicKey: 'pk-lf-refetched',
      });
    });

    expect(screen.getByPlaceholderText('pk-lf-...')).toHaveValue('pk-lf-draft');
    expect(screen.getByLabelText('com_config_langfuse_destination')).toHaveValue('eu');
    expect(screen.getByText('com_config_langfuse_not_verified')).toBeVisible();
    expect(mockTest).toHaveBeenCalledTimes(1);
  });

  it('does not advance expectedVersion from a passive background refresh while a draft is in progress', async () => {
    const configuredStatus = {
      configured: true,
      enabled: true,
      destinations,
      destination: 'eu',
      publicKey: 'pk-lf-stored',
      displaySecretKey: 'sk-lf-...515f',
      configVersion: 3,
      effectiveTenantId: TENANT_ID,
    };
    mockGet.mockResolvedValue(configuredStatus);
    const { queryClient } = renderLangfuse();
    expect(await screen.findByText('com_config_langfuse_verified')).toBeVisible();

    fireEvent.click(
      await screen.findByRole('button', { name: 'com_ui_edit com_config_langfuse_public_key' }),
    );
    fireEvent.change(screen.getByPlaceholderText('pk-lf-...'), {
      target: { value: 'pk-lf-local' },
    });

    // Simulates a passive background refresh (e.g. on network reconnect,
    // which React Query retries by default) landing while this admin still
    // has an unsaved public-key draft -- another admin's write already
    // bumped the version server-side, with no conflict ever surfacing here
    // since nothing was submitted yet.
    act(() => {
      queryClient.setQueryData(TENANT_LANGFUSE_QUERY_KEY, {
        ...configuredStatus,
        publicKey: 'pk-lf-remote',
        configVersion: 4,
        effectiveTenantId: TENANT_ID,
      });
    });

    // The stored connection's public key just changed underneath, so the
    // mount-verification effect re-verifies against it (status.publicKey,
    // not the untouched local draft) -- let that settle before clicking
    // Save, since testMutation.isPending briefly disables it again.
    await waitFor(() => expect(mockTest).toHaveBeenCalledTimes(2));

    mockUpdate.mockResolvedValueOnce({
      ...configuredStatus,
      publicKey: 'pk-lf-local',
      configVersion: 5,
      effectiveTenantId: TENANT_ID,
    });
    const saveButton = screen.getByRole('button', { name: 'com_config_langfuse_save_and_enable' });
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    // Before this fix, expectedVersion was read directly from status.configVersion,
    // which the passive refresh above already advanced to 4 -- so this save
    // would have carried expectedVersion: 4, passing CAS on a version never
    // actually paired with this draft's content.
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith({
      data: expect.objectContaining({ expectedVersion: 3, publicKey: 'pk-lf-local' }),
    });
  });

  it('rebase resolves with its own independent call even while a same-key fetchQuery is still in flight', async () => {
    // React Query's fetchQuery joins an already-in-flight request for the
    // same key regardless of staleTime, so a rebase implemented on top of
    // fetchQuery (instead of calling getLangfuseConnectionFn directly) could
    // adopt whatever a still-pending, pre-conflict background refetch
    // eventually resolves with -- stale content paired with a version that
    // looks fresh only because it's frozen, not because it reflects this
    // rebase's own read.
    const configuredStatus = {
      configured: true,
      enabled: true,
      destinations,
      destination: 'eu',
      publicKey: 'pk-lf-existing',
      displaySecretKey: 'sk-lf-...515f',
      configVersion: 3,
      effectiveTenantId: TENANT_ID,
    };
    mockGet.mockResolvedValue(configuredStatus);
    const conflictError = Object.assign(new Error('Config version conflict'), {
      name: 'ConfigVersionConflictError',
    });
    mockUpdate.mockRejectedValueOnce(conflictError);
    const { queryClient } = renderLangfuse();
    await screen.findByText('sk-lf-...515f');
    await waitFor(() => expect(mockTest).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'com_config_langfuse_disable' }));
    await screen.findByRole('dialog');

    // A same-key fetchQuery is still pending when the rebase is triggered.
    let resolvePendingFetch: ((value: typeof configuredStatus) => void) | undefined;
    mockGet.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePendingFetch = resolve;
      }),
    );
    const staleInFlight = queryClient.fetchQuery({
      queryKey: TENANT_LANGFUSE_QUERY_KEY,
      queryFn: () => getLangfuseConnectionFn({ data: { expectedTenantId: TENANT_ID } }),
    });
    const rebasedStatus = { ...configuredStatus, configVersion: 9 };
    mockGet.mockResolvedValueOnce(rebasedStatus);

    fireEvent.click(screen.getByRole('button', { name: 'com_config_version_conflict_rebase' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // The rebase adopted version 9 from its own direct call, not the
    // version-3 response the still-pending fetchQuery above will eventually
    // resolve with.
    expect(queryClient.getQueryData(TENANT_LANGFUSE_QUERY_KEY)).toEqual(rebasedStatus);

    // Settling the stale in-flight fetch afterward must not silently revert
    // the cache: calling getLangfuseConnectionFn directly stops the rebase
    // from *adopting* a stale in-flight response, but does nothing on its
    // own to stop that older request from resolving later and overwriting
    // what was just installed -- only cancelling it first (installFreshConnection)
    // does that.
    await act(async () => {
      resolvePendingFetch?.(configuredStatus);
      await staleInFlight.catch(() => undefined);
    });
    expect(queryClient.getQueryData(TENANT_LANGFUSE_QUERY_KEY)).toEqual(rebasedStatus);
    expect(screen.getByLabelText('com_config_langfuse_destination')).toHaveValue('eu');
  });

  it('retries a transient mount verification failure after the connection refreshes', async () => {
    const configuredStatus = {
      configured: true,
      enabled: true,
      destinations,
      destination: 'eu',
      publicKey: 'pk-lf-stored',
      displaySecretKey: 'sk-lf-...515f',
      configVersion: 3,
      effectiveTenantId: TENANT_ID,
    };
    mockGet.mockResolvedValue(configuredStatus);
    mockTest.mockRejectedValueOnce(new Error('Langfuse is temporarily unavailable'));
    mockTest.mockResolvedValueOnce({ success: true });
    const { queryClient } = renderLangfuse();

    expect(await screen.findByText('Langfuse is temporarily unavailable')).toBeVisible();
    expect(mockTest).toHaveBeenCalledTimes(1);

    act(() => {
      queryClient.setQueryData(TENANT_LANGFUSE_QUERY_KEY, { ...configuredStatus });
    });

    expect(await screen.findByText('com_config_langfuse_verified')).toBeVisible();
    expect(mockTest).toHaveBeenCalledTimes(2);
  });

  it('ignores an in-flight verification result after a key edit', async () => {
    let resolveVerification: ((result: { success: boolean }) => void) | undefined;
    mockTest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveVerification = resolve;
        }),
    );
    renderLangfuse();

    fireEvent.change(await screen.findByPlaceholderText('pk-lf-...'), {
      target: { value: 'pk-lf-old' },
    });
    fireEvent.change(screen.getByPlaceholderText('sk-lf-...'), {
      target: { value: 'sk-lf-secret' },
    });
    fireEvent.change(screen.getByLabelText('com_config_langfuse_destination'), {
      target: { value: 'eu' },
    });
    await waitFor(() => expect(mockTest).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByPlaceholderText('pk-lf-...'), {
      target: { value: 'pk-lf-new' },
    });
    expect(screen.getByText('com_config_langfuse_not_verified')).toBeVisible();

    await act(async () => resolveVerification?.({ success: true }));

    expect(screen.getByText('com_config_langfuse_not_verified')).toBeVisible();
    expect(screen.queryByText('com_config_langfuse_verified')).not.toBeInTheDocument();
  });

  it('disables a saved connection without re-verifying credentials', async () => {
    const configuredStatus = {
      configured: true,
      enabled: true,
      destinations,
      destination: 'eu',
      publicKey: 'pk-lf-existing',
      displaySecretKey: 'sk-lf-...515f',
      configVersion: 3,
      effectiveTenantId: TENANT_ID,
    };
    mockGet.mockResolvedValue(configuredStatus);
    mockUpdate.mockResolvedValue({ ...configuredStatus, enabled: false });
    renderLangfuse();
    await screen.findByText('sk-lf-...515f');
    await waitFor(() => expect(mockTest).toHaveBeenCalledTimes(1));
    mockTest.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'com_config_langfuse_disable' }));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        data: {
          enabled: false,
          destination: 'eu',
          publicKey: 'pk-lf-existing',
          expectedVersion: 3,
          expectedTenantId: TENANT_ID,
        },
      }),
    );
    expect(mockTest).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'com_config_langfuse_enable' })).toBeEnabled();
  });

  it('opens a rebase/discard dialog on a version conflict instead of silently overwriting the draft', async () => {
    const configuredStatus = {
      configured: true,
      enabled: true,
      destinations,
      destination: 'eu',
      publicKey: 'pk-lf-existing',
      displaySecretKey: 'sk-lf-...515f',
      configVersion: 3,
      effectiveTenantId: TENANT_ID,
    };
    mockGet.mockResolvedValue(configuredStatus);
    const conflictError = Object.assign(new Error('Config version conflict'), {
      name: 'ConfigVersionConflictError',
    });
    mockUpdate.mockRejectedValueOnce(conflictError);
    renderLangfuse();
    await screen.findByText('sk-lf-...515f');
    await waitFor(() => expect(mockTest).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'com_config_langfuse_disable' }));

    expect(await screen.findByRole('dialog')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'com_config_version_conflict_rebase' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'com_config_version_conflict_discard' }),
    ).toBeVisible();
  });

  it('rebase preserves a touched public key/secret draft, refreshes the untouched destination, and stays immune to a later stale tracked refetch', async () => {
    const configuredStatus = {
      configured: true,
      enabled: true,
      destinations,
      destination: 'eu',
      publicKey: 'pk-lf-existing',
      displaySecretKey: 'sk-lf-...515f',
      configVersion: 3,
      effectiveTenantId: TENANT_ID,
    };
    mockGet.mockResolvedValue(configuredStatus);
    const conflictError = Object.assign(new Error('Config version conflict'), {
      name: 'ConfigVersionConflictError',
    });
    mockUpdate.mockRejectedValueOnce(conflictError);
    const { queryClient } = renderLangfuse();
    await screen.findByText('sk-lf-...515f');
    await waitFor(() => expect(mockTest).toHaveBeenCalledTimes(1));

    fireEvent.click(
      screen.getByRole('button', { name: 'com_ui_edit com_config_langfuse_public_key' }),
    );
    fireEvent.change(screen.getByPlaceholderText('pk-lf-...'), {
      target: { value: 'pk-lf-draft' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'com_ui_edit com_config_langfuse_secret_key' }),
    );
    fireEvent.change(screen.getByPlaceholderText('sk-lf-...'), {
      target: { value: 'sk-lf-draft-secret' },
    });

    const saveButton = screen.getByRole('button', { name: 'com_config_langfuse_save_and_enable' });
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);
    await screen.findByRole('dialog');

    // Another admin moved the destination too, concurrently with this draft.
    const rebasedStatus = { ...configuredStatus, destination: 'us', configVersion: 9 };
    mockGet.mockResolvedValueOnce(rebasedStatus);
    const freshBaseConfig = makeBaseConfigResult({
      dbConfigVersion: 9,
      config: { langfuse: { marker: 'rebase' } },
    });
    mockGetBaseConfig.mockResolvedValueOnce(freshBaseConfig);

    fireEvent.click(screen.getByRole('button', { name: 'com_config_version_conflict_rebase' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // The public-key/secret-key draft the admin was actively typing survives the rebase untouched...
    expect(screen.getByPlaceholderText('pk-lf-...')).toHaveValue('pk-lf-draft');
    expect(screen.getByPlaceholderText('sk-lf-...')).toHaveValue('sk-lf-draft-secret');
    // ...but the untouched destination adopts the fresh value instead of staying on the stale 'eu'.
    expect(screen.getByLabelText('com_config_langfuse_destination')).toHaveValue('us');
    expect(queryClient.getQueryData(TENANT_LANGFUSE_QUERY_KEY)).toEqual(rebasedStatus);
    // The complete fresh baseConfig result (content and version together) is
    // installed, not just a patched dbConfigVersion on stale content.
    expect(queryClient.getQueryData(TENANT_BASE_QUERY_KEY)).toEqual(freshBaseConfig);

    // A tracked refetch that started AFTER cancelQueries ran can still resolve
    // afterward with an older version than what the rebase installed. The
    // query's version-aware structural sharing must reject that result before
    // it can regress either the cache or the component's local state.
    await act(async () => {
      queryClient.setQueryData(TENANT_LANGFUSE_QUERY_KEY, {
        ...configuredStatus,
        destination: 'eu',
        configVersion: 6,
        effectiveTenantId: TENANT_ID,
      });
      await Promise.resolve();
    });
    expect(queryClient.getQueryData(TENANT_LANGFUSE_QUERY_KEY)).toEqual(rebasedStatus);
    expect(screen.getByLabelText('com_config_langfuse_destination')).toHaveValue('us');

    // Keep Cancel defensive even if stale data entered the cache through a
    // pre-existing/dehydrated query or another caller without the structural
    // sharing policy. The component already knows v6 is stale, so Cancel must
    // reset and verify against its adopted v9 record rather than this cache.
    act(() => {
      queryClient
        .getQueryCache()
        .find({ queryKey: TENANT_LANGFUSE_QUERY_KEY })
        ?.setState({
          data: {
            ...configuredStatus,
            destination: 'eu',
            configVersion: 6,
            effectiveTenantId: TENANT_ID,
          },
        });
    });
    expect(queryClient.getQueryData(TENANT_LANGFUSE_QUERY_KEY)).toMatchObject({
      destination: 'eu',
      configVersion: 6,
      effectiveTenantId: TENANT_ID,
    });

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_cancel' }));

    await waitFor(() => expect(screen.queryByPlaceholderText('pk-lf-...')).not.toBeInTheDocument());
    expect(screen.queryByPlaceholderText('sk-lf-...')).not.toBeInTheDocument();
    expect(screen.getByLabelText('com_config_langfuse_destination')).toHaveValue('us');
    expect(mockTest).toHaveBeenLastCalledWith({
      data: {
        destination: 'us',
        publicKey: 'pk-lf-existing',
        expectedTenantId: TENANT_ID,
      },
    });
  });

  it('recomputes the destination touched flag against the fresh baseline after a rebase reveals the same value', async () => {
    const configuredStatus = {
      configured: true,
      enabled: true,
      destinations,
      destination: 'eu',
      publicKey: 'pk-lf-existing',
      displaySecretKey: 'sk-lf-...515f',
      configVersion: 3,
      effectiveTenantId: TENANT_ID,
    };
    mockGet.mockResolvedValue(configuredStatus);
    const conflictError = Object.assign(new Error('Config version conflict'), {
      name: 'ConfigVersionConflictError',
    });
    mockUpdate.mockRejectedValueOnce(conflictError);
    const { queryClient } = renderLangfuse();
    await screen.findByText('sk-lf-...515f');
    await waitFor(() => expect(mockTest).toHaveBeenCalledTimes(1));

    // Admin locally changes destination to 'us' -- marks it touched. This
    // also re-triggers verification against the new value, so wait for that
    // to settle before the save button reflects its normal label again.
    fireEvent.change(screen.getByLabelText('com_config_langfuse_destination'), {
      target: { value: 'us' },
    });
    await waitFor(() => expect(mockTest).toHaveBeenCalledTimes(2));
    const saveButton = screen.getByRole('button', { name: 'com_config_langfuse_save_and_enable' });
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);
    await screen.findByRole('dialog');

    // Another admin independently changed the server destination to that
    // SAME 'us' value, concurrently with this draft.
    const rebasedStatus = { ...configuredStatus, destination: 'us', configVersion: 9 };
    mockGet.mockResolvedValueOnce(rebasedStatus);
    mockGetBaseConfig.mockResolvedValueOnce(
      makeBaseConfigResult({ dbConfigVersion: 9, config: {} }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'com_config_version_conflict_rebase' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('com_config_langfuse_destination')).toHaveValue('us');

    // Before this fix, the touched ref was preserved unchanged across the
    // rebase (it happened to still read "touched" because it was never
    // re-evaluated against the fresh baseline, not because a real
    // divergence survived) -- so this later passive refresh, which the
    // admin never asked to be frozen against, would have been silently
    // ignored and the destination would have stayed stuck on 'us' forever,
    // freezing expectedVersion and causing unnecessary 409s on every save.
    act(() => {
      queryClient.setQueryData(TENANT_LANGFUSE_QUERY_KEY, {
        ...rebasedStatus,
        destination: 'eu',
        configVersion: 10,
        effectiveTenantId: TENANT_ID,
      });
    });
    await waitFor(() =>
      expect(screen.getByLabelText('com_config_langfuse_destination')).toHaveValue('eu'),
    );
  });

  it('discard clears the draft and installs the complete fresh baseConfig result, not just its version', async () => {
    const configuredStatus = {
      configured: true,
      enabled: true,
      destinations,
      destination: 'eu',
      publicKey: 'pk-lf-existing',
      displaySecretKey: 'sk-lf-...515f',
      configVersion: 3,
      effectiveTenantId: TENANT_ID,
    };
    mockGet.mockResolvedValue(configuredStatus);
    const conflictError = Object.assign(new Error('Config version conflict'), {
      name: 'ConfigVersionConflictError',
    });
    mockUpdate.mockRejectedValueOnce(conflictError);
    const { queryClient } = renderLangfuse();
    await screen.findByText('sk-lf-...515f');
    await waitFor(() => expect(mockTest).toHaveBeenCalledTimes(1));
    const getCallsBeforeConflict = mockGet.mock.calls.length;
    const freshBaseConfig = makeBaseConfigResult({
      dbConfigVersion: 9,
      config: { langfuse: { marker: 'discard' } },
    });
    mockGetBaseConfig.mockResolvedValueOnce(freshBaseConfig);

    fireEvent.click(screen.getByRole('button', { name: 'com_config_langfuse_disable' }));
    await screen.findByRole('dialog');

    fireEvent.click(screen.getByRole('button', { name: 'com_config_version_conflict_discard' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // Discard fetches the fresh connection directly (to get its configVersion
    // synchronously), not just an invalidate of LANGFUSE_CONNECTION_QUERY_KEY.
    await waitFor(() => expect(mockGet.mock.calls.length).toBeGreaterThan(getCallsBeforeConflict));
    // The complete fresh baseConfig result (content and version together) is
    // installed, not just a patched dbConfigVersion on stale content.
    expect(queryClient.getQueryData(TENANT_BASE_QUERY_KEY)).toEqual(freshBaseConfig);
  });

  it('installs the complete fresh baseConfig result (content and version together) after a successful save', async () => {
    // Regression: ConfigPage freezes its own expectedVersion from the
    // ['baseConfig'] query's dbConfigVersion and only re-syncs it once no
    // edit is in progress. A save here bumps the SAME shared document's
    // configVersion — patching only the version number into a stale cached
    // `config` would let ConfigPage freeze a fresh version against content
    // that never reflected this save's own change to the document (or any
    // other admin's concurrent change that caused it), until a separate
    // background refetch happened to land — or indefinitely, if it failed.
    mockGet.mockResolvedValue({
      configured: false,
      enabled: false,
      destinations,
      configVersion: null,
      effectiveTenantId: TENANT_ID,
    });
    mockUpdate.mockResolvedValue({
      configured: true,
      enabled: true,
      destinations,
      destination: 'eu',
      publicKey: 'pk-lf-new',
      displaySecretKey: 'sk-lf-...cret',
      configVersion: 7,
      effectiveTenantId: TENANT_ID,
    });
    const { queryClient } = renderLangfuse();
    await screen.findByPlaceholderText('pk-lf-...');
    queryClient.setQueryData(TENANT_BASE_QUERY_KEY, { dbConfigVersion: 1, config: {} });
    const freshBaseConfig = makeBaseConfigResult({
      dbConfigVersion: 7,
      config: { langfuse: { enabled: true } },
    });
    mockGetBaseConfig.mockResolvedValueOnce(freshBaseConfig);

    fireEvent.change(screen.getByLabelText('com_config_langfuse_destination'), {
      target: { value: 'eu' },
    });
    fireEvent.change(screen.getByPlaceholderText('pk-lf-...'), {
      target: { value: 'pk-lf-new' },
    });
    fireEvent.change(screen.getByPlaceholderText('sk-lf-...'), {
      target: { value: 'sk-lf-new-secret' },
    });
    const saveButton = screen.getByRole('button', { name: 'com_config_langfuse_save_and_enable' });
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockGetBaseConfig).toHaveBeenCalledTimes(1));
    expect(queryClient.getQueryData(TENANT_BASE_QUERY_KEY)).toEqual(freshBaseConfig);
  });

  it('falls back to invalidation, without blocking the save toast, when the post-save baseConfig fetch fails', async () => {
    mockGet.mockResolvedValue({
      configured: false,
      enabled: false,
      destinations,
      configVersion: null,
      effectiveTenantId: TENANT_ID,
    });
    mockUpdate.mockResolvedValue({
      configured: true,
      enabled: true,
      destinations,
      destination: 'eu',
      publicKey: 'pk-lf-new',
      displaySecretKey: 'sk-lf-...cret',
      configVersion: 7,
      effectiveTenantId: TENANT_ID,
    });
    const { queryClient } = renderLangfuse();
    await screen.findByPlaceholderText('pk-lf-...');
    mockGetBaseConfig.mockRejectedValueOnce(new Error('network blip'));
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    fireEvent.change(screen.getByLabelText('com_config_langfuse_destination'), {
      target: { value: 'eu' },
    });
    fireEvent.change(screen.getByPlaceholderText('pk-lf-...'), {
      target: { value: 'pk-lf-new' },
    });
    fireEvent.change(screen.getByPlaceholderText('sk-lf-...'), {
      target: { value: 'sk-lf-new-secret' },
    });
    const saveButton = screen.getByRole('button', { name: 'com_config_langfuse_save_and_enable' });
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    // The Langfuse save itself succeeded regardless of the failed follow-up
    // fetch — its own state updates (masked key display, editing flags) must
    // still land, not be blocked by that unrelated failure.
    await screen.findByText('sk-lf-...cret');
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['baseConfig'] }));
  });

  it('does not clear the draft until the LANGFUSE_CONNECTION_QUERY_KEY refetch actually lands', async () => {
    // Regression for a race: clearing the draft (secretKey, editing flags)
    // synchronously — before the post-conflict refetch resolves — lets the
    // sync effect apply the still-stale cached connection to state as soon
    // as hasDraftRef flips, flickering back to pre-conflict values instead
    // of the fresh post-conflict connection.
    const configuredStatus = {
      configured: true,
      enabled: true,
      destinations,
      destination: 'eu',
      publicKey: 'pk-lf-existing',
      displaySecretKey: 'sk-lf-...515f',
      configVersion: 3,
      effectiveTenantId: TENANT_ID,
    };
    mockGet.mockResolvedValue(configuredStatus);
    const conflictError = Object.assign(new Error('Config version conflict'), {
      name: 'ConfigVersionConflictError',
    });
    mockUpdate.mockRejectedValueOnce(conflictError);
    renderLangfuse();
    await screen.findByText('sk-lf-...515f');
    await waitFor(() => expect(mockTest).toHaveBeenCalledTimes(1));

    fireEvent.click(
      screen.getByRole('button', { name: 'com_ui_edit com_config_langfuse_secret_key' }),
    );
    fireEvent.change(screen.getByPlaceholderText('sk-lf-...'), {
      target: { value: 'sk-lf-draft-secret' },
    });
    const saveButton = screen.getByRole('button', { name: 'com_config_langfuse_save_and_enable' });
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);
    await screen.findByRole('dialog');

    let resolveRefetch: ((value: typeof configuredStatus) => void) | undefined;
    mockGet.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRefetch = resolve;
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'com_config_version_conflict_discard' }));

    // The refetch triggered by invalidateQueries is still pending — the
    // typed draft must survive, not be cleared out from under the pending
    // request.
    await Promise.resolve();
    expect(screen.getByPlaceholderText('sk-lf-...')).toHaveValue('sk-lf-draft-secret');

    await act(async () => {
      resolveRefetch?.(configuredStatus);
    });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('sk-lf-...515f')).toBeVisible();
  });

  it('installs the complete fresh baseConfig result after a successful save, since Langfuse writes bump its version too', async () => {
    const configuredStatus = {
      configured: true,
      enabled: true,
      destinations,
      destination: 'eu',
      publicKey: 'pk-lf-existing',
      displaySecretKey: 'sk-lf-...515f',
      configVersion: 3,
      effectiveTenantId: TENANT_ID,
    };
    mockGet.mockResolvedValue(configuredStatus);
    mockUpdate.mockResolvedValue({ ...configuredStatus, enabled: false });
    const { queryClient } = renderLangfuse();
    await screen.findByText('sk-lf-...515f');
    await waitFor(() => expect(mockTest).toHaveBeenCalledTimes(1));
    const freshBaseConfig = makeBaseConfigResult({
      dbConfigVersion: 4,
      config: { langfuse: { enabled: false } },
    });
    mockGetBaseConfig.mockResolvedValueOnce(freshBaseConfig);

    fireEvent.click(screen.getByRole('button', { name: 'com_config_langfuse_disable' }));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        data: {
          enabled: false,
          destination: 'eu',
          publicKey: 'pk-lf-existing',
          expectedVersion: 3,
          expectedTenantId: TENANT_ID,
        },
      }),
    );
    await waitFor(() =>
      expect(queryClient.getQueryData(TENANT_BASE_QUERY_KEY)).toEqual(freshBaseConfig),
    );
  });

  it('enables a saved connection without re-verifying credentials', async () => {
    const configuredStatus = {
      configured: true,
      enabled: false,
      destinations,
      destination: 'eu',
      publicKey: 'pk-lf-existing',
      displaySecretKey: 'sk-lf-...515f',
      configVersion: 4,
      effectiveTenantId: TENANT_ID,
    };
    mockGet.mockResolvedValue(configuredStatus);
    mockUpdate.mockResolvedValue({ ...configuredStatus, enabled: true });
    renderLangfuse();
    await screen.findByText('sk-lf-...515f');
    await waitFor(() => expect(mockTest).toHaveBeenCalledTimes(1));
    mockTest.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'com_config_langfuse_enable' }));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        data: {
          enabled: true,
          destination: 'eu',
          publicKey: 'pk-lf-existing',
          expectedVersion: 4,
          expectedTenantId: TENANT_ID,
        },
      }),
    );
    expect(mockTest).not.toHaveBeenCalled();
    expect(
      await screen.findByRole('button', { name: 'com_config_langfuse_disable' }),
    ).toBeEnabled();
  });

  it('enables a disabled connection when credential edits are saved with Save & enable', async () => {
    const configuredStatus = {
      configured: true,
      enabled: false,
      destinations,
      destination: 'eu',
      publicKey: 'pk-lf-existing',
      displaySecretKey: 'sk-lf-...515f',
      configVersion: 4,
      effectiveTenantId: TENANT_ID,
    };
    mockGet.mockResolvedValue(configuredStatus);
    mockUpdate.mockResolvedValue({ ...configuredStatus, enabled: true, publicKey: 'pk-lf-new' });
    renderLangfuse();
    await screen.findByText('sk-lf-...515f');

    fireEvent.click(
      screen.getByRole('button', { name: 'com_ui_edit com_config_langfuse_public_key' }),
    );
    fireEvent.change(screen.getByPlaceholderText('pk-lf-...'), {
      target: { value: 'pk-lf-new' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'com_config_langfuse_save_and_enable' }));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        data: {
          enabled: true,
          destination: 'eu',
          publicKey: 'pk-lf-new',
          expectedVersion: 4,
          expectedTenantId: TENANT_ID,
        },
      }),
    );
  });

  it('re-verifies the stored connection when an invalid key edit is cancelled', async () => {
    mockGet.mockResolvedValue({
      configured: true,
      enabled: true,
      destinations,
      destination: 'eu',
      publicKey: 'pk-lf-existing',
      displaySecretKey: 'sk-lf-...515f',
      configVersion: 3,
      effectiveTenantId: TENANT_ID,
    });
    renderLangfuse();
    await screen.findByText('com_config_langfuse_verified');
    mockTest.mockResolvedValueOnce({ success: false, message: 'invalid keys' });

    fireEvent.click(
      screen.getByRole('button', { name: 'com_ui_edit com_config_langfuse_public_key' }),
    );
    fireEvent.change(screen.getByPlaceholderText('pk-lf-...'), {
      target: { value: 'pk-lf-invalid' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'com_config_langfuse_save_and_enable' }));
    expect(await screen.findByText('invalid keys')).toBeVisible();

    mockTest.mockResolvedValueOnce({ success: true });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_cancel' }));

    expect(await screen.findByText('com_config_langfuse_verified')).toBeVisible();
    expect(mockTest).toHaveBeenLastCalledWith({
      data: {
        destination: 'eu',
        publicKey: 'pk-lf-existing',
        expectedTenantId: TENANT_ID,
      },
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does not expose tenant-wide connection controls in a scoped editor', () => {
    renderLangfuse({ isEditingScope: true });
    expect(screen.getByText('com_config_langfuse_tenant_wide')).toBeVisible();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('disables actions when the section is read-only', async () => {
    renderLangfuse({ disabled: true });

    expect(await screen.findByRole('button', { name: 'com_ui_cancel' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'com_config_langfuse_save_and_enable' }),
    ).toBeDisabled();
  });
});
