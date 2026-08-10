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

interface MockIconButtonProps {
  icon: string;
  onClick?: () => void;
  disabled?: boolean;
  'aria-label'?: string;
}

vi.mock('@clickhouse/click-ui', () => ({
  Icon: () => <span />,
  MultiAccordion: Object.assign(
    ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    {
      Item: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    },
  ),
  IconButton: ({ icon, onClick, disabled, ...rest }: MockIconButtonProps) => (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={rest['aria-label'] ?? icon}
      data-testid={`icon-button-${icon}`}
    />
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

vi.mock('@/components/shared', async () => {
  const actual = await vi.importActual<typeof import('@/components/shared')>('@/components/shared');
  return {
    ...actual,
    FormDialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
      open ? <div data-testid="form-dialog">{children}</div> : null,
  };
});

const noop = () => {};
const getValue = (_path: string, fallback: t.ConfigValue) => fallback;

function customEndpointFields(): t.SchemaField[] {
  return [
    createField({
      key: 'custom',
      type: 'array<object>',
      isArray: true,
      children: [
        createField({ key: 'name', type: 'string' }),
        createField({ key: 'baseURL', type: 'string' }),
      ],
    }),
  ];
}

function renderCustomEndpoints({
  items,
  editedValues = {},
  yamlBaseKeys,
  dbOverrideKeys,
  isEditingScope,
  onChange = vi.fn(),
  onResetEntryOverrides,
}: {
  items: t.ConfigValue[];
  editedValues?: t.FlatConfigMap;
  yamlBaseKeys?: Set<string>;
  dbOverrideKeys?: Set<string>;
  isEditingScope?: boolean;
  onChange?: (path: string, value: t.ConfigValue) => void;
  onResetEntryOverrides?: (target: t.EntryResetTarget) => void;
}) {
  const props: t.FieldRendererProps = {
    fields: customEndpointFields(),
    parentValue: { custom: items },
    parentPath: 'endpoints',
    getValue,
    onChange,
    editedValues,
    yamlBaseKeys,
    dbOverrideKeys,
    isEditingScope,
    onResetEntryOverrides,
  };
  return { ...render(<CustomEndpointsRenderer {...props} />), onChange };
}

describe('CustomEndpointsRenderer — YAML-defined endpoints (issue #108)', () => {
  const yamlEp = { name: 'yamlEp', baseURL: 'https://yaml.example' };
  const adminEp = { name: 'adminEp', baseURL: 'https://admin.example' };

  it('hides the trash for YAML-defined endpoints but keeps it for admin-created ones', () => {
    const { container } = renderCustomEndpoints({
      items: [yamlEp, adminEp],
      yamlBaseKeys: new Set(['yamlEp']),
    });
    expect(container.querySelector('button[aria-label="com_ui_delete yamlEp"]')).toBeNull();
    expect(container.querySelector('button[aria-label="com_ui_delete adminEp"]')).not.toBeNull();
  });

  it('shows a reset-to-YAML action on an overridden YAML endpoint and reports the array item target', () => {
    const onResetEntryOverrides = vi.fn();
    renderCustomEndpoints({
      items: [yamlEp, adminEp],
      yamlBaseKeys: new Set(['yamlEp']),
      dbOverrideKeys: new Set(['yamlEp']),
      onResetEntryOverrides,
    });
    const resetBtn = screen.getByTestId('icon-button-refresh');
    fireEvent.click(resetBtn);
    expect(onResetEntryOverrides).toHaveBeenCalledWith({
      fieldPath: 'endpoints.custom',
      itemName: 'yamlEp',
      label: 'yamlEp',
    });
  });

  it('hides the reset action when the YAML endpoint has no stored override', () => {
    renderCustomEndpoints({
      items: [yamlEp],
      yamlBaseKeys: new Set(['yamlEp']),
      dbOverrideKeys: new Set<string>(),
      onResetEntryOverrides: vi.fn(),
    });
    expect(screen.queryByTestId('icon-button-refresh')).toBeNull();
  });

  it('disables the reset action while edits are pending', () => {
    renderCustomEndpoints({
      items: [yamlEp],
      editedValues: { 'endpoints.custom.0': { ...yamlEp, baseURL: 'https://staged.example' } },
      yamlBaseKeys: new Set(['yamlEp']),
      dbOverrideKeys: new Set(['yamlEp']),
      onResetEntryOverrides: vi.fn(),
    });
    expect(screen.getByTestId('icon-button-refresh').hasAttribute('disabled')).toBe(true);
  });

  it('locks the name field on YAML-defined endpoints (merge identity) but not on admin-created ones', () => {
    const { container } = renderCustomEndpoints({
      items: [yamlEp, adminEp],
      yamlBaseKeys: new Set(['yamlEp']),
    });

    fireEvent.click(screen.getByText('yamlEp'));
    const yamlName = container.querySelector('input#yamlEp-name') as HTMLInputElement | null;
    expect(yamlName).not.toBeNull();
    expect(yamlName!.hasAttribute('disabled')).toBe(true);
    const yamlBaseURL = container.querySelector('input#yamlEp-baseURL') as HTMLInputElement | null;
    expect(yamlBaseURL).not.toBeNull();
    expect(yamlBaseURL!.hasAttribute('disabled')).toBe(false);

    fireEvent.click(screen.getByText('adminEp'));
    const adminName = container.querySelector('input#adminEp-name') as HTMLInputElement | null;
    expect(adminName).not.toBeNull();
    expect(adminName!.hasAttribute('disabled')).toBe(false);
  });

  it('fails closed when YAML provenance is unavailable: trash hidden, name locked, reset hidden', () => {
    /** yamlBaseKeys is undefined only when the baseOnly provenance fetch failed; any entry could be YAML-defined, so identity actions lock for all of them. */
    const { container } = renderCustomEndpoints({
      items: [yamlEp, adminEp],
      yamlBaseKeys: undefined,
      dbOverrideKeys: new Set(['yamlEp', 'adminEp']),
      onResetEntryOverrides: vi.fn(),
    });
    expect(container.querySelector('button[aria-label^="com_ui_delete"]')).toBeNull();
    expect(screen.queryByTestId('icon-button-refresh')).toBeNull();
    fireEvent.click(screen.getByText('adminEp'));
    const adminName = container.querySelector('input#adminEp-name') as HTMLInputElement | null;
    expect(adminName).not.toBeNull();
    expect(adminName!.hasAttribute('disabled')).toBe(true);
  });

  it('keeps entries fully editable when provenance is known and empty (no YAML endpoints)', () => {
    const { container } = renderCustomEndpoints({
      items: [adminEp],
      yamlBaseKeys: new Set<string>(),
    });
    expect(container.querySelector('button[aria-label="com_ui_delete adminEp"]')).not.toBeNull();
    fireEvent.click(screen.getByText('adminEp'));
    const adminName = container.querySelector('input#adminEp-name') as HTMLInputElement | null;
    expect(adminName).not.toBeNull();
    expect(adminName!.hasAttribute('disabled')).toBe(false);
  });

  it('keeps scope mode unaffected: trash stays and name stays editable for YAML endpoints', () => {
    const { container } = renderCustomEndpoints({
      items: [yamlEp],
      yamlBaseKeys: new Set(['yamlEp']),
      dbOverrideKeys: new Set(['yamlEp']),
      isEditingScope: true,
      onResetEntryOverrides: vi.fn(),
    });
    expect(container.querySelector('button[aria-label="com_ui_delete yamlEp"]')).not.toBeNull();
    expect(screen.queryByTestId('icon-button-refresh')).toBeNull();
    fireEvent.click(screen.getByText('yamlEp'));
    const nameInput = container.querySelector('input#yamlEp-name') as HTMLInputElement | null;
    expect(nameInput).not.toBeNull();
    expect(nameInput!.hasAttribute('disabled')).toBe(false);
  });
});

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
