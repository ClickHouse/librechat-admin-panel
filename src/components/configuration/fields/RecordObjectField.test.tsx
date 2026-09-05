import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type * as t from '@/types';
import { RecordObjectField } from './RecordObjectField';
import { createField } from '@/test/fixtures';

vi.mock('@/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

vi.mock('@clickhouse/click-ui', () => ({
  Icon: () => null,
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
}));

const entryFields: t.SchemaField[] = [
  createField({ key: 'baseURL', type: 'string' }),
  createField({ key: 'headers', type: 'record', recordValueType: 'primitive' }),
];

const noopRenderFields: t.CollectionRenderFields = () => null;

function expandEntry(label: string) {
  fireEvent.click(screen.getByText(label).closest('[role="button"]') as HTMLElement);
}

describe('RecordObjectField — strips untouched secret-record containers on structural edits', () => {
  it('strips a redacted headers placeholder from a surviving entry when adding a new key', () => {
    const onChange = vi.fn();
    render(
      <RecordObjectField
        id="mcpServers"
        value={{ existing: { baseURL: 'https://old', headers: {} } }}
        fields={entryFields}
        onChange={onChange}
        renderFields={noopRenderFields}
      />,
    );
    fireEvent.click(screen.getByText('com_ui_add_item'));
    fireEvent.change(screen.getByPlaceholderText('com_ui_key'), { target: { value: 'newKey' } });
    fireEvent.click(screen.getByText('com_ui_add'));
    expect(onChange).toHaveBeenCalledWith({
      newKey: {},
      existing: { baseURL: 'https://old' },
    });
  });

  it('strips a redacted headers placeholder from a surviving entry when removing another', () => {
    const onChange = vi.fn();
    render(
      <RecordObjectField
        id="mcpServers"
        value={{
          a: { baseURL: 'https://old', headers: {} },
          b: { baseURL: 'https://other' },
        }}
        fields={entryFields}
        onChange={onChange}
        renderFields={noopRenderFields}
      />,
    );
    fireEvent.click(screen.getAllByLabelText(/com_ui_delete/)[1]);
    expect(onChange).toHaveBeenCalledWith({ a: { baseURL: 'https://old' } });
  });

  it('strips a redacted headers placeholder from a surviving entry when renaming another', () => {
    const onChange = vi.fn();
    render(
      <RecordObjectField
        id="mcpServers"
        value={{
          a: { baseURL: 'https://old', headers: {} },
          b: { baseURL: 'https://other' },
        }}
        fields={entryFields}
        onChange={onChange}
        renderFields={noopRenderFields}
      />,
    );
    expandEntry('b');
    fireEvent.click(screen.getByLabelText(/com_a11y_rename_entry/));
    fireEvent.change(screen.getByDisplayValue('b'), { target: { value: 'renamed' } });
    fireEvent.keyDown(screen.getByDisplayValue('renamed'), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith({
      a: { baseURL: 'https://old' },
      renamed: { baseURL: 'https://other' },
    });
  });

  it('keeps a headers container the admin actually edited (array-shaped, even if emptied)', () => {
    const onChange = vi.fn();
    render(
      <RecordObjectField
        id="mcpServers"
        value={{
          a: { baseURL: 'https://old', headers: [] },
          b: { baseURL: 'https://other' },
        }}
        fields={entryFields}
        onChange={onChange}
        renderFields={noopRenderFields}
      />,
    );
    fireEvent.click(screen.getAllByLabelText(/com_ui_delete/)[1]);
    expect(onChange).toHaveBeenCalledWith({ a: { baseURL: 'https://old', headers: [] } });
  });
});
