import { vi, describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type * as t from '@/types';
import { ProfileValueModal, getDefaultValue } from './ProfileValueModal';
import { createField } from '@/test/fixtures';

vi.mock('@/hooks/useLocalize', () => ({
  default: () => (key: string) => key,
  useLocalize: () => (key: string) => key,
}));

interface ChildrenProps {
  children?: React.ReactNode;
}
interface ButtonProps {
  label?: string;
  onClick?: () => void;
}
interface IconButtonProps {
  icon: string;
  onClick?: () => void;
  'aria-label'?: string;
}

vi.mock('@clickhouse/click-ui', () => ({
  Icon: () => null,
  Button: ({ label, onClick }: ButtonProps) => <button onClick={onClick}>{label}</button>,
  IconButton: ({ icon, onClick, ...props }: IconButtonProps) => (
    <button onClick={onClick} aria-label={props['aria-label'] ?? icon} />
  ),
  Select: Object.assign(({ children }: ChildrenProps) => <div>{children}</div>, {
    Item: ({ children }: ChildrenProps) => <div>{children}</div>,
  }),
  Dialog: Object.assign(({ children }: ChildrenProps) => <div>{children}</div>, {
    Content: ({ children }: ChildrenProps) => <div>{children}</div>,
  }),
}));

describe('getDefaultValue', () => {
  it('returns an empty record for record fields so an untouched save stays object-typed', () => {
    expect(getDefaultValue('record')).toEqual({});
  });

  it('returns an empty array for array fields', () => {
    expect(getDefaultValue('array')).toEqual([]);
  });
});

describe('ProfileValueModal — record fields', () => {
  function renderModal(value: t.ConfigValue, onChange: (v: t.ConfigValue) => void) {
    return render(
      <ProfileValueModal
        open
        fieldSchema={createField({ key: 'headers', type: 'record' })}
        controlType="record"
        value={value}
        onChange={onChange}
        onSave={() => {}}
        onCancel={() => {}}
        saving={false}
        scopeName="Base configuration"
        scopeType="BASE"
        mode="edit"
      />,
    );
  }

  it('emits an empty record, not an empty array, when the last row is removed', () => {
    const onChange = vi.fn();
    renderModal({ Authorization: 'Bearer token' }, onChange);
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_delete com_ui_entry 1' }));
    expect(onChange).toHaveBeenCalledWith({});
  });

  it('keeps in-progress rows as raw pairs while editing', () => {
    const onChange = vi.fn();
    renderModal({ Authorization: 'Bearer token' }, onChange);
    const valueInput = screen.getByLabelText('com_ui_value 1');
    fireEvent.change(valueInput, { target: { value: 'Bearer {{API_KEY}}' } });
    fireEvent.blur(valueInput);
    expect(onChange).toHaveBeenCalledWith([
      { key: 'Authorization', value: 'Bearer {{API_KEY}}', valueType: 'string' },
    ]);
  });
});
