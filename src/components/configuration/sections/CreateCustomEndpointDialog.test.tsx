import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type * as t from '@/types';
import { CreateCustomEndpointDialog } from './CreateCustomEndpointDialog';
import { createField } from '@/test/fixtures';

vi.mock('@/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

vi.mock('@clickhouse/click-ui', () => ({
  Button: ({
    label,
    onClick,
    disabled,
    type,
  }: {
    label?: string;
    onClick?: () => void;
    disabled?: boolean;
    type?: string;
  }) => (
    <button type={type === 'primary' ? 'submit' : 'button'} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  ),
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

const nameField: t.SchemaField[] = [createField({ key: 'name', type: 'string' })];

const renderNameInput: t.CollectionRenderFields = (_fields, parentValue, _entryKey, onChange) => {
  const value =
    parentValue && typeof parentValue === 'object' && !Array.isArray(parentValue)
      ? ((parentValue as Record<string, t.ConfigValue>).name as string | undefined)
      : undefined;
  return (
    <input
      aria-label="name"
      value={value ?? ''}
      onChange={(e) => onChange('name', e.target.value)}
    />
  );
};

describe('CreateCustomEndpointDialog — duplicate name prevention', () => {
  it('rejects a name that already exists instead of calling onSave', () => {
    const onSave = vi.fn();
    render(
      <CreateCustomEndpointDialog
        open
        onClose={vi.fn()}
        onSave={onSave}
        fields={nameField}
        renderFields={renderNameInput}
        existingNames={new Set(['OpenRouter'])}
      />,
    );
    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'OpenRouter' } });
    fireEvent.click(screen.getByText('com_ui_create'));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('com_config_endpoint_name_duplicate');
  });

  it('saves and closes for a name that does not collide with an existing entry', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <CreateCustomEndpointDialog
        open
        onClose={onClose}
        onSave={onSave}
        fields={nameField}
        renderFields={renderNameInput}
        existingNames={new Set(['OpenRouter'])}
      />,
    );
    fireEvent.change(screen.getByLabelText('name'), { target: { value: 'Anyscale' } });
    fireEvent.click(screen.getByText('com_ui_create'));

    expect(onSave).toHaveBeenCalledWith({ name: 'Anyscale', __previousIdentity: null });
    expect(onClose).toHaveBeenCalled();
  });
});
