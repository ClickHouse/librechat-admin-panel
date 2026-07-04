import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type * as t from '@/types';
import { LangfuseRenderer } from '../LangfuseRenderer';
import { testLangfuseConnectionFn } from '@/server';

vi.mock('@/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

vi.mock('@/server', () => ({
  testLangfuseConnectionFn: vi.fn(),
}));

interface SwitchProps {
  checked: boolean;
  disabled?: boolean;
  onCheckedChange?: (v: boolean) => void;
  'aria-label'?: string;
}
interface TextFieldProps {
  label?: string;
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  onChange?: (v: string) => void;
}
interface ButtonProps {
  label?: string;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
}

vi.mock('@clickhouse/click-ui', () => ({
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
      aria-label={label}
      value={value ?? ''}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
  Button: ({ label, disabled, onClick }: ButtonProps) => (
    <button aria-label={label} disabled={disabled} onClick={onClick}>
      {label}
    </button>
  ),
}));

vi.mock('@/components/PasswordInput', () => ({
  PasswordInput: ({ label, value, placeholder, disabled, onChange }: TextFieldProps) => (
    <input
      aria-label={label}
      type="password"
      value={value ?? ''}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

const mockTest = vi.mocked(testLangfuseConnectionFn);

function renderLangfuse({
  parentValue = {},
  editedValues = {},
  disabled,
  onChange = vi.fn(),
}: {
  parentValue?: Record<string, t.ConfigValue>;
  editedValues?: t.FlatConfigMap;
  disabled?: boolean;
  onChange?: (path: string, value: t.ConfigValue) => void;
} = {}) {
  const props: t.FieldRendererProps = {
    fields: [],
    parentValue,
    parentPath: 'langfuse',
    getValue: (path, fallback) => (path in editedValues ? (editedValues[path] ?? fallback) : fallback),
    onChange,
    editedValues,
    disabled,
  };
  return { ...render(<LangfuseRenderer {...props} />), onChange };
}

beforeEach(() => {
  mockTest.mockReset();
});

describe('LangfuseRenderer', () => {
  it('renders the enable toggle with a ConfigRow label alongside host, public key, and secret fields', () => {
    renderLangfuse();
    expect(screen.getByText('com_config_langfuse_enabled')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeInTheDocument();
    expect(screen.getByLabelText('com_config_langfuse_base_url')).toBeInTheDocument();
    expect(screen.getByLabelText('com_config_langfuse_public_key')).toBeInTheDocument();
    expect(screen.getByLabelText('com_config_langfuse_secret_key')).toBeInTheDocument();
  });

  it('leaves Test connection disabled until host, public key, and secret are all present', () => {
    renderLangfuse({ parentValue: { baseUrl: 'https://cloud.langfuse.com', publicKey: 'pk-lf-1' } });
    expect(screen.getByRole('button', { name: 'com_config_langfuse_test' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('com_config_langfuse_secret_key'), {
      target: { value: 'sk-lf-secret' },
    });
    expect(screen.getByRole('button', { name: 'com_config_langfuse_test' })).toBeEnabled();
  });

  it('prefills stored host and public key, shows the fingerprint, and never renders the secret', () => {
    renderLangfuse({
      parentValue: {
        enabled: true,
        baseUrl: 'https://cloud.langfuse.com',
        publicKey: 'pk-lf-1',
        secretKeyFingerprint: 'abc123def456',
      },
    });
    expect(screen.getByLabelText('com_config_langfuse_base_url')).toHaveValue(
      'https://cloud.langfuse.com',
    );
    expect(screen.getByLabelText('com_config_langfuse_public_key')).toHaveValue('pk-lf-1');
    expect(screen.getByLabelText('com_config_langfuse_secret_key')).toHaveValue('');
    expect(screen.getByText('abc123def456')).toBeInTheDocument();
  });

  it('does not show a fingerprint when the connection is unconfigured', () => {
    renderLangfuse();
    expect(screen.queryByText('com_config_langfuse_fingerprint')).not.toBeInTheDocument();
  });

  it('propagates edits to the correct config paths', () => {
    const { onChange } = renderLangfuse();
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.change(screen.getByLabelText('com_config_langfuse_base_url'), {
      target: { value: 'https://cloud.langfuse.com' },
    });
    fireEvent.change(screen.getByLabelText('com_config_langfuse_secret_key'), {
      target: { value: 'sk-lf-secret' },
    });
    expect(onChange).toHaveBeenCalledWith('langfuse.enabled', true);
    expect(onChange).toHaveBeenCalledWith('langfuse.baseUrl', 'https://cloud.langfuse.com');
    expect(onChange).toHaveBeenCalledWith('langfuse.secretKey', 'sk-lf-secret');
  });

  it('runs a connection test with the entered credentials and reports success', async () => {
    mockTest.mockResolvedValue({ success: true });
    renderLangfuse({ parentValue: { baseUrl: 'https://cloud.langfuse.com', publicKey: 'pk-lf-1' } });
    fireEvent.change(screen.getByLabelText('com_config_langfuse_secret_key'), {
      target: { value: 'sk-lf-secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'com_config_langfuse_test' }));
    expect(mockTest).toHaveBeenCalledWith({
      data: { baseUrl: 'https://cloud.langfuse.com', publicKey: 'pk-lf-1', secretKey: 'sk-lf-secret' },
    });
    expect(await screen.findByText('com_config_langfuse_test_ok')).toBeInTheDocument();
  });

  it('surfaces the failure message when the connection test fails', async () => {
    mockTest.mockResolvedValue({ success: false, message: 'invalid credentials' });
    renderLangfuse({ parentValue: { baseUrl: 'https://cloud.langfuse.com', publicKey: 'pk-lf-1' } });
    fireEvent.change(screen.getByLabelText('com_config_langfuse_secret_key'), {
      target: { value: 'sk-lf-bad' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'com_config_langfuse_test' }));
    expect(await screen.findByText('invalid credentials')).toBeInTheDocument();
  });
});
