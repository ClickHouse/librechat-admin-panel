import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type * as t from '@/types';
import { ProvidersRenderer, CustomEndpointsRenderer } from '../EndpointsRenderer';
import { createField } from '@/test/fixtures';

vi.mock('@/hooks/useLocalize', () => ({
  default: () => (key: string) => key,
  useLocalize: () => (key: string) => key,
}));

interface MockTextFieldProps {
  id?: string;
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  'aria-label'?: string;
}

vi.mock('@clickhouse/click-ui', () => ({
  Icon: () => <span />,
  IconButton: ({
    onClick,
    'aria-label': ariaLabel,
  }: {
    onClick?: () => void;
    'aria-label'?: string;
  }) => <button onClick={onClick} aria-label={ariaLabel} />,
  Button: ({ label, onClick }: { label?: string; onClick?: () => void }) => (
    <button onClick={onClick}>{label}</button>
  ),
  MultiAccordion: Object.assign(
    ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    {
      Item: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    },
  ),
  TextField: ({ id, value, onChange, disabled, ...rest }: MockTextFieldProps) => (
    <input
      id={id}
      value={value ?? ''}
      disabled={disabled}
      aria-label={rest['aria-label']}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

vi.mock('../CreateCustomEndpointDialog', () => ({
  CreateCustomEndpointDialog: ({
    open,
    onSave,
  }: {
    open: boolean;
    onSave: (entry: Record<string, t.ConfigValue>) => void;
  }) => (open ? <button onClick={() => onSave({ name: 'NewEndpoint' })}>save-new-endpoint</button> : null),
}));

const noop = () => {};
const getValue = (_path: string, fallback: t.ConfigValue) => fallback;

describe('ProvidersRenderer', () => {
  const providerFields: t.SchemaField[] = [
    createField({
      key: 'openAI',
      children: [createField({ key: 'apiKey', type: 'string' })],
    }),
  ];

  it('renders a masked secret for a provider apiKey with a display companion', () => {
    render(
      <ProvidersRenderer
        fields={providerFields}
        parentValue={{ openAI: { apiKeyPreview: 'sk-test...1234' } }}
        parentPath="endpoints"
        getValue={getValue}
        onChange={noop}
      />,
    );
    expect(screen.getByDisplayValue('sk-test...1234')).toBeDisabled();
  });

  it('shows a normal editable input for a provider apiKey while its reset is pending', () => {
    render(
      <ProvidersRenderer
        fields={providerFields}
        parentValue={{ openAI: { apiKeyPreview: 'sk-test...1234' } }}
        parentPath="endpoints"
        getValue={getValue}
        onChange={noop}
        pendingResets={new Set(['endpoints.openAI.apiKey'])}
      />,
    );
    expect(screen.queryByDisplayValue('sk-test...1234')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).not.toBeDisabled();
  });

  it('forwards editedValues so a cleared-but-queued provider secret stays visible after remount', () => {
    render(
      <ProvidersRenderer
        fields={providerFields}
        parentValue={{ openAI: { apiKeyPreview: 'sk-test...1234' } }}
        parentPath="endpoints"
        getValue={getValue}
        onChange={noop}
        touchedPaths={new Set(['endpoints.openAI.apiKey'])}
        editedValues={{ 'endpoints.openAI.apiKey': '' }}
      />,
    );
    expect(screen.queryByDisplayValue('sk-test...1234')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).not.toBeDisabled();
  });
});

describe('CustomEndpointsRenderer', () => {
  const customFields: t.SchemaField[] = [
    createField({
      key: 'custom',
      children: [
        createField({ key: 'name', type: 'string' }),
        createField({ key: 'baseURL', type: 'string' }),
        createField({ key: 'headers', type: 'record', recordValueType: 'primitive' }),
      ],
    }),
  ];

  it('strips a redacted headers placeholder from a surviving entry when creating a new one', () => {
    const onChange = vi.fn();
    render(
      <CustomEndpointsRenderer
        fields={customFields}
        parentValue={{ custom: [{ name: 'OpenRouter', baseURL: 'https://old', headers: {} }] }}
        parentPath="endpoints"
        getValue={getValue}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText('com_config_create_endpoint'));
    fireEvent.click(screen.getByText('save-new-endpoint'));
    expect(onChange).toHaveBeenCalledWith('endpoints.custom', [
      { name: 'OpenRouter', baseURL: 'https://old' },
      { name: 'NewEndpoint' },
    ]);
  });
});
