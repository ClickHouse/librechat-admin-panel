import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type * as t from '@/types';
import {
  McpServersRenderer,
  YAML_LOCKED_FIELDS,
  INSPECTOR_DERIVED,
  enumerateLeafPaths,
} from '../McpServersRenderer';
import { createField } from '@/test/fixtures';

vi.mock('@/hooks/useLocalize', () => ({
  default: () => (key: string) => key,
  useLocalize: () => (key: string) => key,
}));

interface IconProps {
  name: string;
}
interface SwitchProps {
  checked: boolean;
  onCheckedChange?: (v: boolean) => void;
  'aria-label'?: string;
}
interface SelectProps {
  children: React.ReactNode;
  value: string;
  'aria-label'?: string;
  onValueChange?: (v: string) => void;
}
interface SelectItemProps {
  children: React.ReactNode;
  value: string;
}
interface ButtonProps {
  label?: string;
  onClick?: () => void;
  children?: React.ReactNode;
}
interface TextFieldProps {
  id?: string;
  value?: string;
  placeholder?: string;
  onChange?: (v: string) => void;
  onBlur?: () => void;
  type?: string;
  disabled?: boolean;
  'aria-label'?: string;
}
interface NumberFieldProps {
  id?: string;
  value?: string | number;
  placeholder?: string;
  onChange?: (v: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
}
interface IconButtonProps {
  icon: string;
  onClick?: () => void;
  'aria-label'?: string;
}

vi.mock('@clickhouse/click-ui', () => ({
  Icon: ({ name }: IconProps) => <span data-testid={`icon-${name}`} />,
  Switch: (props: SwitchProps) => (
    <button
      role="switch"
      aria-checked={props.checked}
      aria-label={props['aria-label']}
      onClick={() => props.onCheckedChange?.(!props.checked)}
    />
  ),
  Select: Object.assign(
    ({ children, value, ...props }: SelectProps) => (
      <div data-testid="select" data-value={value} aria-label={props['aria-label']}>
        {children}
      </div>
    ),
    {
      Item: ({ children, value }: SelectItemProps) => (
        <div data-testid="select-item" data-value={value}>
          {children}
        </div>
      ),
    },
  ),
  Button: ({ label, onClick, children }: ButtonProps) => (
    <button onClick={onClick}>{label ?? children}</button>
  ),
  IconButton: ({ icon, onClick, ...props }: IconButtonProps) => (
    <button
      onClick={onClick}
      aria-label={props['aria-label'] ?? icon}
      data-testid={`icon-button-${icon}`}
    />
  ),
  TextField: ({
    id,
    value,
    placeholder,
    onChange,
    onBlur,
    type,
    disabled,
    ...rest
  }: TextFieldProps) => (
    <input
      id={id}
      value={value ?? ''}
      placeholder={placeholder}
      type={type ?? 'text'}
      disabled={disabled}
      aria-label={rest['aria-label']}
      onChange={(e) => onChange?.(e.target.value)}
      onBlur={onBlur}
    />
  ),
  NumberField: ({ id, value, placeholder, onChange, onBlur, disabled }: NumberFieldProps) => (
    <input
      id={id}
      value={value ?? ''}
      placeholder={placeholder}
      type="number"
      disabled={disabled}
      onChange={(e) => onChange?.(e.target.value)}
      onBlur={onBlur}
    />
  ),
}));

vi.mock('@/components/shared', async () => {
  const actual = await vi.importActual<typeof import('@/components/shared')>('@/components/shared');
  return {
    ...actual,
    FormDialog: ({
      open,
      title,
      children,
      onSubmit,
    }: {
      open: boolean;
      title: string;
      children: React.ReactNode;
      onSubmit?: () => void;
    }) =>
      open ? (
        <div data-testid="form-dialog" aria-label={title}>
          {children}
          <button type="button" onClick={onSubmit}>
            submit
          </button>
        </div>
      ) : null,
  };
});

function fieldsForMcp(): t.SchemaField[] {
  return [
    createField({ key: 'type', type: 'enum(stdio | sse | streamable-http | websocket)' }),
    createField({ key: 'url', type: 'string', isOptional: true }),
    createField({ key: 'command', type: 'string', isOptional: true }),
    createField({ key: 'title', type: 'string', isOptional: true }),
    createField({ key: 'description', type: 'string', isOptional: true }),
    createField({ key: 'tools', type: 'array<string>', isOptional: true, isArray: true }),
    createField({ key: 'source', type: 'string', isOptional: true }),
  ];
}

function renderRenderer({
  baseRecord,
  editedValues = {},
  dbOverridePaths,
  yamlBaseKeys,
  onChange = vi.fn(),
  onValidationError = vi.fn(),
  scopeMode,
}: {
  baseRecord: Record<string, t.ConfigValue>;
  editedValues?: t.FlatConfigMap;
  dbOverridePaths?: Set<string>;
  yamlBaseKeys?: Set<string>;
  onChange?: (path: string, value: t.ConfigValue) => void;
  onValidationError?: (message: string) => void;
  scopeMode?: boolean;
}) {
  const fields = fieldsForMcp();
  const props: t.FieldRendererProps = {
    fields,
    parentValue: baseRecord,
    parentPath: 'mcpServers',
    getValue: (path, fallback) => {
      if (path in editedValues) return editedValues[path] ?? fallback;
      if (path === 'mcpServers') return baseRecord;
      return fallback;
    },
    onChange,
    editedValues,
    dbOverridePaths,
    yamlBaseKeys,
    onValidationError,
    scopeMode,
  };
  return {
    ...render(<McpServersRenderer {...props} />),
    onChange,
    onValidationError,
    fields,
  };
}

describe('McpServersRenderer — metadata sets', () => {
  it('locks only the transport-type selector on YAML-defined servers', () => {
    expect(YAML_LOCKED_FIELDS.has('type')).toBe(true);
    for (const key of ['url', 'command', 'args', 'env', 'stderr', 'headers']) {
      expect(YAML_LOCKED_FIELDS.has(key)).toBe(false);
    }
  });

  it('hides inspector-derived fields', () => {
    for (const key of ['tools', 'capabilities', 'source', 'updatedAt']) {
      expect(INSPECTOR_DERIVED.has(key)).toBe(true);
    }
  });
});

describe('McpServersRenderer — per-leaf write granularity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes per-leaf paths when a single string field changes', () => {
    const onChange = vi.fn();
    const baseRecord = {
      kapa: { type: 'sse', url: 'https://example.com' },
    };
    const { container } = renderRenderer({ baseRecord, onChange });

    fireEvent.click(screen.getByText('kapa'));
    const urlInput = container.querySelector('input#kapa-url') as HTMLInputElement | null;
    expect(urlInput).not.toBeNull();
    fireEvent.change(urlInput!, { target: { value: 'https://new.example.com' } });
    fireEvent.blur(urlInput!);

    const urlCalls = onChange.mock.calls.filter(([p]) => p === 'mcpServers.kapa.url');
    expect(urlCalls.length).toBeGreaterThan(0);
    expect(urlCalls[urlCalls.length - 1][1]).toBe('https://new.example.com');
    expect(
      onChange.mock.calls.find(
        ([p, v]) => p === 'mcpServers.kapa' && typeof v === 'object' && v !== null,
      ),
    ).toBeUndefined();
  });
});

describe('McpServersRenderer — YAML source detection', () => {
  it('keeps transport fields editable on a YAML-defined server with no DB overrides', () => {
    const baseRecord = {
      yamlOne: { type: 'stdio', command: 'node', title: 'YAML server' },
    };
    const { container } = renderRenderer({
      baseRecord,
      yamlBaseKeys: new Set(['yamlOne']),
      dbOverridePaths: new Set(),
    });

    fireEvent.click(screen.getByText('yamlOne'));
    const cmd = container.querySelector('input#yamlOne-command') as HTMLInputElement | null;
    expect(cmd).not.toBeNull();
    expect(cmd!.hasAttribute('disabled')).toBe(false);
  });

  it('locks identity (rename/delete) on a YAML-defined server but leaves url editable', () => {
    const baseRecord = {
      kapa: { type: 'sse', url: 'https://example.com', title: 'Edited title' },
    };
    const { container } = renderRenderer({
      baseRecord,
      yamlBaseKeys: new Set(['kapa']),
      dbOverridePaths: new Set(['mcpServers.kapa.title']),
    });

    fireEvent.click(screen.getByText('kapa'));
    const url = container.querySelector('input#kapa-url') as HTMLInputElement | null;
    expect(url).not.toBeNull();
    expect(url!.hasAttribute('disabled')).toBe(false);
    expect(container.querySelector('button[aria-label^="com_ui_delete"]')).toBeNull();
    expect(container.querySelector('button[aria-label^="com_a11y_rename_entry"]')).toBeNull();
  });

  it('does not lock identity for a server defined only via admin overrides', () => {
    const baseRecord = {
      adminOnly: { type: 'sse', url: 'https://admin.example.com', title: 'Admin only' },
    };
    const { container } = renderRenderer({
      baseRecord,
      yamlBaseKeys: new Set<string>(),
      dbOverridePaths: new Set([
        'mcpServers.adminOnly.type',
        'mcpServers.adminOnly.url',
        'mcpServers.adminOnly.title',
      ]),
    });

    fireEvent.click(screen.getByText('adminOnly'));
    const url = container.querySelector('input#adminOnly-url') as HTMLInputElement | null;
    expect(url).not.toBeNull();
    expect(url!.hasAttribute('disabled')).toBe(false);
    expect(container.querySelector('button[aria-label^="com_ui_delete"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label^="com_a11y_rename_entry"]')).not.toBeNull();
  });

  it('treats a freshly-created entry (not in YAML keys) as fully editable', () => {
    const baseRecord = {
      brandNew: { type: 'sse', url: 'https://new.example.com' },
    };
    const { container } = renderRenderer({
      baseRecord,
      yamlBaseKeys: new Set<string>(),
    });

    fireEvent.click(screen.getByText('brandNew'));
    const url = container.querySelector('input#brandNew-url') as HTMLInputElement | null;
    expect(url).not.toBeNull();
    expect(url!.hasAttribute('disabled')).toBe(false);
    expect(container.querySelector('button[aria-label^="com_ui_delete"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label^="com_a11y_rename_entry"]')).not.toBeNull();
  });
});

describe('McpServersRenderer — lock matrix and inspector hide', () => {
  it('does not render inspector-derived fields like source/tools in the card', () => {
    const baseRecord = {
      one: {
        type: 'sse',
        url: 'https://x.com',
        title: 'T',
        source: 'yaml',
        tools: ['t1'],
      },
    };
    const { container } = renderRenderer({
      baseRecord,
      dbOverridePaths: new Set(['mcpServers.one.title']),
    });
    fireEvent.click(screen.getByText('one'));
    const sourceInput = container.querySelector('input[id="mcpServers-one-source"]');
    expect(sourceInput).toBeNull();
  });
});

describe('McpServersRenderer — rejects dotted server names', () => {
  it('shows a no-dots error when create receives a name with a dot', () => {
    const onChange = vi.fn();
    const baseRecord = {};
    renderRenderer({ baseRecord, onChange });

    fireEvent.click(screen.getByText('com_config_create_mcp_server'));
    const dialog = screen.getByTestId('form-dialog');
    const nameInput = dialog.querySelector('#mcp-server-name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'has.dots' } });
    const submit = dialog.querySelector('button[type="button"]') as HTMLButtonElement;
    fireEvent.click(submit);

    expect(onChange).not.toHaveBeenCalledWith(
      expect.stringContaining('mcpServers.has.dots'),
      expect.anything(),
    );
  });
});

describe('McpServersRenderer — scope mode', () => {
  it('disables create and hides rename/delete in scope mode', () => {
    const baseRecord = {
      adminOnly: { type: 'sse', url: 'https://admin.example.com' },
    };
    const { container } = renderRenderer({
      baseRecord,
      yamlBaseKeys: new Set<string>(),
      scopeMode: true,
    });

    const createBtn = screen.getByText('com_config_create_mcp_server')
      .closest('button') as HTMLButtonElement;
    expect(createBtn.hasAttribute('disabled')).toBe(true);

    expect(container.querySelector('button[aria-label^="com_ui_delete"]')).toBeNull();
    expect(container.querySelector('button[aria-label^="com_a11y_rename_entry"]')).toBeNull();
  });

  it('still allows field-level edits to flow as per-leaf scope overrides', () => {
    const onChange = vi.fn();
    const baseRecord = {
      adminOnly: { type: 'sse', url: 'https://admin.example.com' },
    };
    const { container } = renderRenderer({
      baseRecord,
      yamlBaseKeys: new Set<string>(),
      scopeMode: true,
      onChange,
    });

    fireEvent.click(screen.getByText('adminOnly'));
    const urlInput = container.querySelector('input#adminOnly-url') as HTMLInputElement | null;
    expect(urlInput).not.toBeNull();
    expect(urlInput!.hasAttribute('disabled')).toBe(false);
    fireEvent.change(urlInput!, { target: { value: 'https://override.example.com' } });
    fireEvent.blur(urlInput!);

    const urlCalls = onChange.mock.calls.filter(([p]) => p === 'mcpServers.adminOnly.url');
    expect(urlCalls.length).toBeGreaterThan(0);
  });
});

describe('McpServersRenderer — entry order', () => {
  it('keeps an edited entry in its original position instead of moving it to the bottom', () => {
    const baseRecord = {
      alpha: { type: 'sse', url: 'https://a.example.com' },
      beta: { type: 'sse', url: 'https://b.example.com' },
      gamma: { type: 'sse', url: 'https://c.example.com' },
    };
    const editedValues = { 'mcpServers.alpha.url': 'https://a-new.example.com' };
    const { container } = renderRenderer({
      baseRecord,
      editedValues,
      yamlBaseKeys: new Set<string>(),
    });

    const headers = container.querySelectorAll('[data-section-id^="section-mcpServers-"]');
    const renderedKeys = Array.from(headers).map((h) =>
      decodeURIComponent((h.getAttribute('data-section-id') ?? '').replace(/^section-mcpServers-/, '')),
    );
    expect(renderedKeys).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('appends a freshly-created entry at the bottom', () => {
    const baseRecord = {
      alpha: { type: 'sse', url: 'https://a.example.com' },
      beta: { type: 'sse', url: 'https://b.example.com' },
    };
    const editedValues = {
      'mcpServers.brandNew.type': 'sse',
      'mcpServers.brandNew.url': 'https://new.example.com',
    };
    const { container } = renderRenderer({
      baseRecord,
      editedValues,
      yamlBaseKeys: new Set<string>(),
    });

    const headers = container.querySelectorAll('[data-section-id^="section-mcpServers-"]');
    const renderedKeys = Array.from(headers).map((h) =>
      decodeURIComponent((h.getAttribute('data-section-id') ?? '').replace(/^section-mcpServers-/, '')),
    );
    expect(renderedKeys).toEqual(['alpha', 'beta', 'brandNew']);
  });
});

describe('McpServersRenderer — legacy dotted entry keys', () => {
  it('groups edits under the dotted base key instead of splitting on the first dot', () => {
    const baseRecord = {
      'legacy.dotted': { type: 'sse', url: 'https://new.example.com' },
    };
    const { container } = renderRenderer({
      baseRecord,
      yamlBaseKeys: new Set<string>(),
    });

    const header = screen.queryByText('legacy.dotted');
    expect(header).not.toBeNull();
    fireEvent.click(header!);
    const url = container.querySelector('input#legacy-dotted-url') as HTMLInputElement | null;
    expect(url).not.toBeNull();
    expect(url!.value).toBe('https://new.example.com');
  });

  it('renders dotted legacy entries read-only with no rename or delete affordances', () => {
    const onChange = vi.fn();
    const baseRecord = {
      'legacy.dotted': { type: 'sse', url: 'https://old.example.com' },
    };
    const { container } = renderRenderer({
      baseRecord,
      yamlBaseKeys: new Set<string>(),
      onChange,
    });

    fireEvent.click(screen.getByText('legacy.dotted'));
    const url = container.querySelector('input#legacy-dotted-url') as HTMLInputElement | null;
    expect(url).not.toBeNull();
    expect(url!.hasAttribute('disabled')).toBe(true);

    expect(container.querySelector('button[aria-label^="com_ui_delete"]')).toBeNull();
    expect(container.querySelector('button[aria-label^="com_a11y_rename_entry"]')).toBeNull();
  });

  it('emits no per-leaf writes for a dotted entry even if the field would otherwise fire onChange', () => {
    const onChange = vi.fn();
    const baseRecord = {
      'legacy.dotted': { type: 'sse', url: 'https://old.example.com' },
    };
    renderRenderer({
      baseRecord,
      yamlBaseKeys: new Set<string>(),
      onChange,
    });

    const dottedWrites = onChange.mock.calls.filter(([p]) =>
      typeof p === 'string' && p.startsWith('mcpServers.legacy'),
    );
    expect(dottedWrites).toEqual([]);
  });
});

describe('McpServersRenderer — handleRemove', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits undefined for every leaf path including pending edits and base fields', () => {
    const onChange = vi.fn();
    const baseRecord = {
      adminOnly: { type: 'sse', url: 'https://admin.example.com' },
    };
    const editedValues = { 'mcpServers.adminOnly.title': 'X' };
    const { container } = renderRenderer({
      baseRecord,
      editedValues,
      yamlBaseKeys: new Set<string>(),
      onChange,
    });

    const trashBtn = container.querySelector(
      'button[aria-label^="com_ui_delete"]',
    ) as HTMLButtonElement | null;
    expect(trashBtn).not.toBeNull();
    fireEvent.click(trashBtn!);

    const undefinedPaths = onChange.mock.calls.filter(([, v]) => v === undefined).map(([p]) => p);
    expect(undefinedPaths).toEqual(
      expect.arrayContaining([
        'mcpServers.adminOnly.type',
        'mcpServers.adminOnly.url',
        'mcpServers.adminOnly.title',
      ]),
    );
  });

  it('emits an entry-path undefined write so MongoDB unsets the whole subtree', () => {
    const onChange = vi.fn();
    const baseRecord = {
      foo: { type: 'sse', url: 'https://x.com' },
    };
    const { container } = renderRenderer({
      baseRecord,
      yamlBaseKeys: new Set<string>(),
      onChange,
    });

    const trashBtn = container.querySelector(
      'button[aria-label^="com_ui_delete"]',
    ) as HTMLButtonElement | null;
    expect(trashBtn).not.toBeNull();
    fireEvent.click(trashBtn!);

    const entryClear = onChange.mock.calls.find(
      ([p, v]) => p === 'mcpServers.foo' && v === undefined,
    );
    expect(entryClear).toBeDefined();

    const leafClear = onChange.mock.calls.find(
      ([p, v]) => p === 'mcpServers.foo.type' && v === undefined,
    );
    expect(leafClear).toBeDefined();
  });

  it('recurses into nested base fields so leaves like headers.Authorization clear individually', () => {
    const onChange = vi.fn();
    const baseRecord = {
      withHeaders: {
        type: 'sse',
        url: 'https://x.com',
        headers: { Authorization: 'Bearer a' },
      },
    };
    const { container } = renderRenderer({
      baseRecord,
      yamlBaseKeys: new Set<string>(),
      onChange,
    });

    const trashBtn = container.querySelector(
      'button[aria-label^="com_ui_delete"]',
    ) as HTMLButtonElement | null;
    expect(trashBtn).not.toBeNull();
    fireEvent.click(trashBtn!);

    const authClear = onChange.mock.calls.find(
      ([p, v]) => p === 'mcpServers.withHeaders.headers.Authorization' && v === undefined,
    );
    expect(authClear).toBeDefined();

    const wholeHeadersClear = onChange.mock.calls.find(
      ([p]) => p === 'mcpServers.withHeaders.headers',
    );
    expect(wholeHeadersClear).toBeUndefined();
  });
});

describe('McpServersRenderer — handleRename', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function triggerRename(container: HTMLElement, newKey: string) {
    const pencil = container.querySelector(
      'button[aria-label^="com_a11y_rename_entry"]',
    ) as HTMLButtonElement | null;
    expect(pencil).not.toBeNull();
    fireEvent.click(pencil!);
    const renameInput = container.querySelector(
      'input.config-input-ghost',
    ) as HTMLInputElement | null;
    expect(renameInput).not.toBeNull();
    fireEvent.change(renameInput!, { target: { value: newKey } });
    fireEvent.blur(renameInput!);
  }

  it('preserves nested per-leaf data when renaming an entry with headers', () => {
    const onChange = vi.fn();
    const baseRecord = {
      foo: {
        type: 'sse',
        url: 'https://x.com',
        headers: { Authorization: 'Bearer a' },
      },
    };
    const { container } = renderRenderer({
      baseRecord,
      yamlBaseKeys: new Set<string>(),
      onChange,
    });

    fireEvent.click(screen.getByText('foo'));
    triggerRename(container, 'bar');

    const newAuth = onChange.mock.calls.find(
      ([p, v]) => p === 'mcpServers.bar.headers.Authorization' && v === 'Bearer a',
    );
    expect(newAuth).toBeDefined();

    const oldAuthClear = onChange.mock.calls.find(
      ([p, v]) => p === 'mcpServers.foo.headers.Authorization' && v === undefined,
    );
    expect(oldAuthClear).toBeDefined();

    const wholeHeadersWrite = onChange.mock.calls.find(
      ([p, v]) => p === 'mcpServers.bar.headers' && typeof v === 'object' && v !== null,
    );
    expect(wholeHeadersWrite).toBeUndefined();
  });

  it('emits an entry-path undefined write for the old key so MongoDB unsets the whole subtree', () => {
    const onChange = vi.fn();
    const baseRecord = {
      foo: { type: 'sse', url: 'https://x.com' },
    };
    const { container } = renderRenderer({
      baseRecord,
      yamlBaseKeys: new Set<string>(),
      onChange,
    });

    fireEvent.click(screen.getByText('foo'));
    triggerRename(container, 'bar');

    const oldEntryClear = onChange.mock.calls.find(
      ([p, v]) => p === 'mcpServers.foo' && v === undefined,
    );
    expect(oldEntryClear).toBeDefined();

    const oldLeafClear = onChange.mock.calls.find(
      ([p, v]) => p === 'mcpServers.foo.url' && v === undefined,
    );
    expect(oldLeafClear).toBeDefined();

    const newUrlWrite = onChange.mock.calls.find(
      ([p, v]) => p === 'mcpServers.bar.url' && v === 'https://x.com',
    );
    expect(newUrlWrite).toBeDefined();
  });

  it('rejects rename to an existing entry name and reports a validation error', () => {
    const onChange = vi.fn();
    const onValidationError = vi.fn();
    const baseRecord = {
      foo: { type: 'sse', url: 'https://x.com' },
      bar: { type: 'sse', url: 'https://y.com' },
    };
    const { container } = renderRenderer({
      baseRecord,
      yamlBaseKeys: new Set<string>(),
      onChange,
      onValidationError,
    });

    fireEvent.click(screen.getByText('foo'));
    triggerRename(container, 'bar');

    const renamePaths = onChange.mock.calls.filter(
      ([p]) => typeof p === 'string' && p.startsWith('mcpServers.bar.'),
    );
    expect(renamePaths).toEqual([]);
    expect(onValidationError).toHaveBeenCalledWith('com_config_server_name_exists');
  });
});

describe('McpServersRenderer — record overlay', () => {
  it('applies per-leaf edits over the base record (url visible by default)', () => {
    const baseRecord = {
      kapa: { type: 'sse', url: 'https://x.com' },
    };
    const editedValues = { 'mcpServers.kapa.url': 'https://overlay.example.com' };
    const { container } = renderRenderer({
      baseRecord,
      editedValues,
      yamlBaseKeys: new Set<string>(),
    });
    fireEvent.click(screen.getByText('kapa'));
    const urlInput = container.querySelector('input#kapa-url') as HTMLInputElement | null;
    expect(urlInput).not.toBeNull();
    expect(urlInput!.value).toBe('https://overlay.example.com');
  });
});

describe('McpServersRenderer — handleCreate per-leaf writes', () => {
  it('enumerateLeafPaths emits one leaf per primitive even under a nested object', () => {
    const leaves = enumerateLeafPaths({
      type: 'sse',
      url: 'https://example.com',
      headers: { Authorization: 'Bearer a' },
    });
    const flat = leaves.map((l) => ({ path: l.segments.join('.'), value: l.value }));
    expect(flat).toEqual(
      expect.arrayContaining([
        { path: 'type', value: 'sse' },
        { path: 'url', value: 'https://example.com' },
        { path: 'headers.Authorization', value: 'Bearer a' },
      ]),
    );
    const headersWhole = flat.find((l) => l.path === 'headers');
    expect(headersWhole).toBeUndefined();
  });
});

describe('McpServersRenderer — rejects reserved server names', () => {
  it('blocks __proto__ at create without emitting onChange', () => {
    const onChange = vi.fn();
    const baseRecord = {};
    renderRenderer({ baseRecord, onChange });

    fireEvent.click(screen.getByText('com_config_create_mcp_server'));
    const dialog = screen.getByTestId('form-dialog');
    const nameInput = dialog.querySelector('#mcp-server-name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '__proto__' } });
    const submit = dialog.querySelector('button[type="button"]') as HTMLButtonElement;
    fireEvent.click(submit);

    const protoCalls = onChange.mock.calls.filter(
      ([p]) => typeof p === 'string' && p.startsWith('mcpServers.__proto__'),
    );
    expect(protoCalls).toEqual([]);
  });
});

describe('McpServersRenderer — yamlBaseKeys undefined fallback', () => {
  it('locks nothing when yamlBaseKeys is undefined (newer-UI / older-API)', () => {
    const baseRecord = {
      yamlServer: { type: 'sse', url: 'https://x.com', title: 'YAML' },
    };
    const { container } = renderRenderer({
      baseRecord,
      yamlBaseKeys: undefined,
      dbOverridePaths: new Set(['mcpServers.yamlServer.title']),
    });

    fireEvent.click(screen.getByText('yamlServer'));
    expect(container.querySelector('button[aria-label^="com_ui_delete"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label^="com_a11y_rename_entry"]')).not.toBeNull();
  });
});

describe('McpServersRenderer — create then edit then rename preserves nested data', () => {
  it('writes per-leaf paths through edit and rename in sequence', () => {
    const baseRecord = {
      kapa: {
        type: 'sse',
        url: 'https://x.com',
        headers: { Authorization: 'old' },
      },
    };
    const editedValues: t.FlatConfigMap = {
      'mcpServers.kapa.headers.Authorization': 'new',
    };
    const onChange = vi.fn();
    const { container } = renderRenderer({
      baseRecord,
      editedValues,
      yamlBaseKeys: new Set<string>(),
      onChange,
    });

    fireEvent.click(screen.getByText('kapa'));
    const renameBtn = container.querySelector(
      'button[aria-label^="com_a11y_rename_entry"]',
    ) as HTMLButtonElement | null;
    expect(renameBtn).not.toBeNull();
    fireEvent.click(renameBtn!);
    const renameInput = container.querySelector(
      'input.config-input-ghost',
    ) as HTMLInputElement | null;
    expect(renameInput).not.toBeNull();
    fireEvent.change(renameInput!, { target: { value: 'kapa2' } });
    fireEvent.blur(renameInput!);

    const authWrite = onChange.mock.calls.find(
      ([p]) => p === 'mcpServers.kapa2.headers.Authorization',
    );
    expect(authWrite).toBeDefined();
    expect(authWrite![1]).toBe('new');

    const oldClears = onChange.mock.calls.filter(
      ([p, v]) => typeof p === 'string' && p.startsWith('mcpServers.kapa.') && v === undefined,
    );
    expect(oldClears.length).toBeGreaterThan(0);

    const wholeHeadersWrite = onChange.mock.calls.find(
      ([p, v]) => p === 'mcpServers.kapa2.headers' && typeof v === 'object' && v !== null,
    );
    expect(wholeHeadersWrite).toBeUndefined();
  });
});
