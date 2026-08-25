import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type * as t from '@/types';
import { EnumSetField } from './EnumSetField';

vi.mock('@/hooks/useLocalize', () => ({
  default: () => (key: string, options?: Record<string, string | number>) =>
    options ? `${key} ${Object.values(options).join('/')}` : key,
  useLocalize: () => (key: string, options?: Record<string, string | number>) =>
    options ? `${key} ${Object.values(options).join('/')}` : key,
}));

const options: t.SelectOption[] = [
  { label: 'Code interpreter', value: 'code_interpreter' },
  { label: 'File search', value: 'file_search' },
  { label: 'Tools', value: 'tools' },
];

describe('EnumSetField', () => {
  it('renders a checkbox for every option', () => {
    render(<EnumSetField id="caps" value={[]} options={options} onChange={() => {}} />);
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByRole('checkbox', { name: 'Code interpreter' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'File search' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Tools' })).toBeInTheDocument();
  });

  it('checks exactly the options present in the value array', () => {
    render(
      <EnumSetField id="caps" value={['file_search']} options={options} onChange={() => {}} />,
    );
    expect(screen.getByRole('checkbox', { name: 'File search' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Code interpreter' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Tools' })).not.toBeChecked();
  });

  it('adds a toggled-on option in canonical option order', () => {
    const onChange = vi.fn();
    render(<EnumSetField id="caps" value={['tools']} options={options} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Code interpreter' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(['code_interpreter', 'tools']);
  });

  it('removes a toggled-off option and writes the full remaining array', () => {
    const onChange = vi.fn();
    render(
      <EnumSetField
        id="caps"
        value={['code_interpreter', 'tools']}
        options={options}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tools' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(['code_interpreter']);
  });

  it('writes an empty array when the last checked option is toggled off', () => {
    const onChange = vi.fn();
    render(<EnumSetField id="caps" value={['tools']} options={options} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tools' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('renders schema defaults as checked hints when unset without calling onChange', () => {
    const onChange = vi.fn();
    render(
      <EnumSetField
        id="caps"
        value={undefined}
        defaultValue={['code_interpreter', 'file_search']}
        options={options}
        onChange={onChange}
      />,
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: 'Code interpreter' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'File search' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Tools' })).not.toBeChecked();
  });

  it('derives the first written array from the schema default when unset', () => {
    const onChange = vi.fn();
    render(
      <EnumSetField
        id="caps"
        value={undefined}
        defaultValue={['code_interpreter', 'file_search']}
        options={options}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Tools' }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(['code_interpreter', 'file_search', 'tools']);
  });

  it('shows a selected count indicator', () => {
    render(<EnumSetField id="caps" value={['tools']} options={options} onChange={() => {}} />);
    expect(screen.getByText('com_config_enum_selected_count 1/3')).toBeInTheDocument();
  });
});
