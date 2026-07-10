import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as t from '@/types';
import { LangfuseRenderer } from '../LangfuseRenderer';
import {
  getLangfuseConnectionFn,
  LANGFUSE_CONNECTION_QUERY_KEY,
  testLangfuseConnectionFn,
  updateLangfuseConnectionFn,
} from '@/server';

vi.mock('@/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

vi.mock('@/utils', () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
}));

vi.mock('@/server', () => ({
  LANGFUSE_CONNECTION_QUERY_KEY: ['adminLangfuseConnection'],
  getLangfuseConnectionFn: vi.fn(),
  testLangfuseConnectionFn: vi.fn(),
  updateLangfuseConnectionFn: vi.fn(),
}));

interface SwitchProps {
  checked: boolean;
  disabled?: boolean;
  onCheckedChange?: (value: boolean) => void;
  'aria-label'?: string;
}

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
  Switch: (props: SwitchProps) => (
    <button
      role="switch"
      aria-checked={props.checked}
      aria-label={props['aria-label']}
      disabled={props.disabled}
      onClick={() => props.onCheckedChange?.(!props.checked)}
    />
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
}));

const mockGet = vi.mocked(getLangfuseConnectionFn);
const mockTest = vi.mocked(testLangfuseConnectionFn);
const mockUpdate = vi.mocked(updateLangfuseConnectionFn);
const destinations = [
  { key: 'eu', baseUrl: 'https://cloud.langfuse.com' },
  { key: 'us', baseUrl: 'https://us.cloud.langfuse.com' },
];

function renderLangfuse(overrides: Partial<t.FieldRendererProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props: t.FieldRendererProps = {
    fields: [],
    parentValue: {},
    parentPath: 'langfuse',
    getValue: (_path, fallback) => fallback,
    onChange: vi.fn(),
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
  mockGet.mockResolvedValue({ configured: false, enabled: false, destinations });
  mockTest.mockResolvedValue({ success: true });
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
  });

  it('shows masked keys and verifies a configured connection on load', async () => {
    mockGet.mockResolvedValue({
      configured: true,
      enabled: true,
      destinations,
      destination: 'eu',
      publicKey: 'pk-lf-1234567890abcdef',
      displaySecretKey: 'sk-lf-...515f',
    });
    renderLangfuse();

    expect(await screen.findByText('pk-lf-...cdef')).toBeVisible();
    expect(screen.getByText('sk-lf-...515f')).toBeVisible();
    await waitFor(() =>
      expect(mockTest).toHaveBeenCalledWith({
        data: { destination: 'eu', publicKey: 'pk-lf-1234567890abcdef' },
      }),
    );
    expect(await screen.findByText('com_config_langfuse_verified')).toBeVisible();
  });

  it('verifies then saves a new connection through the dedicated API', async () => {
    mockUpdate.mockResolvedValue({
      configured: true,
      enabled: true,
      destinations,
      destination: 'eu',
      publicKey: 'pk-lf-new',
      displaySecretKey: 'sk-lf-...cret',
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
    fireEvent.click(screen.getByRole('switch'));
    const saveButton = screen.getByRole('button', { name: 'com_ui_save' });
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    await waitFor(() =>
      expect(mockTest).toHaveBeenLastCalledWith({
        data: { destination: 'eu', publicKey: 'pk-lf-new', secretKey: 'sk-lf-secret' },
      }),
    );
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        data: {
          enabled: true,
          destination: 'eu',
          publicKey: 'pk-lf-new',
          secretKey: 'sk-lf-secret',
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
    };
    mockGet.mockResolvedValue(configuredStatus);
    mockUpdate.mockResolvedValue({ ...configuredStatus, publicKey: 'pk-lf-new' });
    const { queryClient } = renderLangfuse();

    fireEvent.click(
      await screen.findByRole('button', { name: 'com_ui_edit com_config_langfuse_public_key' }),
    );
    fireEvent.change(screen.getByPlaceholderText('pk-lf-...'), {
      target: { value: 'pk-lf-new' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        data: { enabled: true, destination: 'eu', publicKey: 'pk-lf-new' },
      }),
    );
    await waitFor(() =>
      expect(queryClient.getQueryData(LANGFUSE_CONNECTION_QUERY_KEY)).toEqual({
        ...configuredStatus,
        publicKey: 'pk-lf-new',
      }),
    );
  });

  it('persists the enable toggle without re-verifying credentials', async () => {
    const configuredStatus = {
      configured: true,
      enabled: true,
      destinations,
      destination: 'eu',
      publicKey: 'pk-lf-existing',
      displaySecretKey: 'sk-lf-...515f',
    };
    mockGet.mockResolvedValue(configuredStatus);
    mockUpdate.mockResolvedValue({ ...configuredStatus, enabled: false });
    renderLangfuse();
    await screen.findByText('sk-lf-...515f');
    await waitFor(() => expect(mockTest).toHaveBeenCalledTimes(1));
    mockTest.mockClear();

    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        data: { enabled: false, destination: 'eu', publicKey: 'pk-lf-existing' },
      }),
    );
    expect(mockTest).not.toHaveBeenCalled();
  });

  it('re-verifies the stored connection when an invalid key edit is cancelled', async () => {
    mockGet.mockResolvedValue({
      configured: true,
      enabled: true,
      destinations,
      destination: 'eu',
      publicKey: 'pk-lf-existing',
      displaySecretKey: 'sk-lf-...515f',
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
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
    expect(await screen.findByText('invalid keys')).toBeVisible();

    mockTest.mockResolvedValueOnce({ success: true });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_cancel' }));

    expect(await screen.findByText('com_config_langfuse_verified')).toBeVisible();
    expect(mockTest).toHaveBeenLastCalledWith({
      data: { destination: 'eu', publicKey: 'pk-lf-existing' },
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does not expose tenant-wide connection controls in a scoped editor', () => {
    renderLangfuse({ isEditingScope: true });
    expect(screen.getByText('com_config_langfuse_tenant_wide')).toBeVisible();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
