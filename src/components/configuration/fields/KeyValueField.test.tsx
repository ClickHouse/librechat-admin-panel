import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeyValueField } from './KeyValueField';

vi.mock('@/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

vi.mock('@clickhouse/click-ui', () => {
  function Select({
    children,
    value,
    onSelect,
    'aria-label': ariaLabel,
  }: {
    children?: React.ReactNode;
    value?: string;
    onSelect?: (value: string) => void;
    'aria-label'?: string;
  }) {
    return (
      <select value={value} onChange={(e) => onSelect?.(e.target.value)} aria-label={ariaLabel}>
        {children}
      </select>
    );
  }
  Select.Item = ({ value, children }: { value: string; children?: React.ReactNode }) => (
    <option value={value}>{children}</option>
  );
  return {
    Select,
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
  };
});

describe('KeyValueField — reserved __previousIdentity key', () => {
  it('flags __previousIdentity as reserved on an mcpServers headers path, without dropping the row', () => {
    render(
      <KeyValueField
        id="headers"
        pairs={[{ key: '__previousIdentity', value: 'not-a-hint', valueType: 'string' }]}
        onChange={vi.fn()}
        fieldPath="mcpServers.Jira.headers"
      />,
    );
    expect(screen.getByText('com_config_header_key_reserved')).toBeInTheDocument();
    expect(screen.getByLabelText('com_ui_key 1')).toHaveClass('config-input-error');
  });

  it('flags __previousIdentity as reserved on an mcpServers oauth_headers path too', () => {
    render(
      <KeyValueField
        id="oauth_headers"
        pairs={[{ key: '__previousIdentity', value: 'not-a-hint', valueType: 'string' }]}
        onChange={vi.fn()}
        fieldPath="mcpServers.Jira.oauth_headers"
      />,
    );
    expect(screen.getByText('com_config_header_key_reserved')).toBeInTheDocument();
  });

  it('does not flag __previousIdentity on an unrelated field path — no hint protocol to collide with', () => {
    render(
      <KeyValueField
        id="headers"
        pairs={[{ key: '__previousIdentity', value: 'a-real-value', valueType: 'string' }]}
        onChange={vi.fn()}
        fieldPath="endpoints.openAI.headers"
      />,
    );
    expect(screen.queryByText('com_config_header_key_reserved')).not.toBeInTheDocument();
    expect(screen.getByLabelText('com_ui_key 1')).not.toHaveClass('config-input-error');
  });

  it('does not flag __previousIdentity when no fieldPath is supplied at all', () => {
    render(
      <KeyValueField
        id="headers"
        pairs={[{ key: '__previousIdentity', value: 'a-real-value', valueType: 'string' }]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByText('com_config_header_key_reserved')).not.toBeInTheDocument();
  });

  it('does not flag a normal header key on an mcpServers headers path', () => {
    render(
      <KeyValueField
        id="headers"
        pairs={[{ key: 'Authorization', value: 'Bearer abc', valueType: 'string' }]}
        onChange={vi.fn()}
        fieldPath="mcpServers.Jira.headers"
      />,
    );
    expect(screen.queryByText('com_config_header_key_reserved')).not.toBeInTheDocument();
  });

  it('flags __previousIdentity as reserved on a json-typed row too', () => {
    render(
      <KeyValueField
        id="headers"
        pairs={[{ key: '__previousIdentity', value: '{"a":1}', valueType: 'json' }]}
        onChange={vi.fn()}
        fieldPath="mcpServers.Jira.headers"
      />,
    );
    expect(screen.getByText('com_config_header_key_reserved')).toBeInTheDocument();
  });

  it('still calls onChange with the row intact when the reserved key is typed — the drop happens at save-serialization, not here', () => {
    const onChange = vi.fn();
    render(
      <KeyValueField
        id="headers"
        pairs={[{ key: '', value: '', valueType: 'string' }]}
        onChange={onChange}
        fieldPath="mcpServers.Jira.headers"
      />,
    );
    fireEvent.blur(screen.getByLabelText('com_ui_key 1'), {
      target: { value: '__previousIdentity' },
    });
    fireEvent.change(screen.getByLabelText('com_ui_key 1'), {
      target: { value: '__previousIdentity' },
    });
    fireEvent.blur(screen.getByLabelText('com_ui_key 1'));
    expect(onChange).toHaveBeenCalledWith([
      { key: '__previousIdentity', value: '', valueType: 'string' },
    ]);
  });
});
