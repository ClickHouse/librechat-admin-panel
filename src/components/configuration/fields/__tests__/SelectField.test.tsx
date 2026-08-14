import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SelectField } from '../SelectField';

vi.mock('@/hooks/useLocalize', () => ({
  default: () => (key: string) => key,
  useLocalize: () => (key: string) => key,
}));

interface MockSelectProps {
  children?: React.ReactNode;
  value?: string;
  onSelect?: (value: string) => void;
  'aria-label'?: string;
}
interface MockSelectItemProps {
  children?: React.ReactNode;
  value: string;
}

vi.mock('@clickhouse/click-ui', () => {
  const Select = ({ children, value, onSelect, 'aria-label': ariaLabel }: MockSelectProps) => (
    <select value={value ?? ''} onChange={(e) => onSelect?.(e.target.value)} aria-label={ariaLabel}>
      {children}
    </select>
  );
  Select.Item = ({ children, value }: MockSelectItemProps) => (
    <option value={value}>{children}</option>
  );
  return { Select };
});

const formatOptions = [
  { label: 'png', value: 'png' },
  { label: 'webp', value: 'webp' },
];

describe('SelectField', () => {
  it('renders an unknown value as a visible selected option', () => {
    render(
      <SelectField
        id="imageOutputType"
        value="format_from_newer_librechat"
        options={formatOptions}
        onChange={vi.fn()}
      />,
    );

    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('format_from_newer_librechat');
    expect(screen.getByRole('option', { name: 'format_from_newer_librechat' })).toBeInTheDocument();
  });

  it('does not render an extra option when the value is known', () => {
    render(
      <SelectField id="imageOutputType" value="png" options={formatOptions} onChange={vi.fn()} />,
    );

    expect(screen.getAllByRole('option')).toHaveLength(formatOptions.length);
  });

  it('does not render an extra option when the value is empty', () => {
    render(
      <SelectField id="imageOutputType" value="" options={formatOptions} onChange={vi.fn()} />,
    );

    expect(screen.getAllByRole('option')).toHaveLength(formatOptions.length);
  });

  it('keeps known options selectable alongside an unknown value', () => {
    const onChange = vi.fn();
    render(
      <SelectField
        id="imageOutputType"
        value="format_from_newer_librechat"
        options={formatOptions}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'png' } });
    expect(onChange).toHaveBeenCalledWith('png');
  });
});
