import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ListField } from '../ListField';

vi.mock('@/hooks/useLocalize', () => ({
  default: () => (key: string) => key,
  useLocalize: () => (key: string) => key,
}));

interface MockButtonProps {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}
interface MockIconButtonProps {
  onClick?: () => void;
  'aria-label'?: string;
}

vi.mock('@clickhouse/click-ui', () => ({
  Button: ({ label, onClick, disabled }: MockButtonProps) => (
    <button onClick={onClick} disabled={disabled}>
      {label}
    </button>
  ),
  IconButton: ({ onClick, 'aria-label': ariaLabel }: MockIconButtonProps) => (
    <button onClick={onClick} aria-label={ariaLabel} />
  ),
}));

const capabilityOptions = [
  { label: 'execute_code', value: 'execute_code' },
  { label: 'web_search', value: 'web_search' },
  { label: 'tools', value: 'tools' },
];

describe('ListField with enum options', () => {
  it('renders an unknown value as a visible selected option', () => {
    render(
      <ListField
        id="capabilities"
        values={['execute_code', 'capability_from_newer_librechat']}
        onChange={vi.fn()}
        options={capabilityOptions}
      />,
    );

    const selects = screen.getAllByRole('combobox');
    expect((selects[1] as HTMLSelectElement).value).toBe('capability_from_newer_librechat');
    expect(
      screen.getByRole('option', { name: 'capability_from_newer_librechat' }),
    ).toBeInTheDocument();
  });

  it('does not render an extra option when all values are known', () => {
    render(
      <ListField
        id="capabilities"
        values={['execute_code', 'web_search']}
        onChange={vi.fn()}
        options={capabilityOptions}
      />,
    );

    expect(screen.getAllByRole('option')).toHaveLength(capabilityOptions.length * 2);
  });

  it('keeps the unknown value when another row is edited', () => {
    const onChange = vi.fn();
    render(
      <ListField
        id="capabilities"
        values={['execute_code', 'capability_from_newer_librechat']}
        onChange={onChange}
        options={capabilityOptions}
      />,
    );

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'web_search' } });
    expect(onChange).toHaveBeenCalledWith(['web_search', 'capability_from_newer_librechat']);
  });

  it('keeps the unknown value when another row is removed', () => {
    const onChange = vi.fn();
    render(
      <ListField
        id="capabilities"
        values={['execute_code', 'capability_from_newer_librechat']}
        onChange={onChange}
        options={capabilityOptions}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_delete com_ui_item 1' }));
    expect(onChange).toHaveBeenCalledWith(['capability_from_newer_librechat']);
  });

  it('shows Add when a known option remains unselected despite an unknown value', () => {
    const onChange = vi.fn();
    render(
      <ListField
        id="capabilities"
        values={['capability_from_newer_librechat', 'execute_code', 'web_search']}
        onChange={onChange}
        options={capabilityOptions}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'com_ui_add_item' }));
    expect(onChange).toHaveBeenCalledWith([
      'capability_from_newer_librechat',
      'execute_code',
      'web_search',
      'tools',
    ]);
  });

  it('hides Add when every known option is selected alongside an unknown value', () => {
    render(
      <ListField
        id="capabilities"
        values={['capability_from_newer_librechat', 'execute_code', 'web_search', 'tools']}
        onChange={vi.fn()}
        options={capabilityOptions}
      />,
    );

    expect(screen.queryByRole('button', { name: 'com_ui_add_item' })).not.toBeInTheDocument();
  });

  it('shows the unknown value as plain text when disabled', () => {
    render(
      <ListField
        id="capabilities"
        values={['capability_from_newer_librechat']}
        onChange={vi.fn()}
        options={capabilityOptions}
        disabled
      />,
    );

    expect(screen.getByText('capability_from_newer_librechat')).toBeInTheDocument();
  });
});
