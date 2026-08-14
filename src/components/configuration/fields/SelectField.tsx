import { Select } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useLocalize } from '@/hooks';

export function SelectField({
  id,
  value,
  options,
  onChange,
  disabled,
  placeholder,
  'aria-label': ariaLabel,
}: t.SelectFieldProps) {
  const localize = useLocalize();
  const isUnknownValue = value !== '' && !options.some((o) => o.value === value);

  return (
    <div className="select-field-a11y max-w-75" id={id}>
      <Select
        value={value || undefined}
        onSelect={(v) => onChange(v)}
        placeholder={placeholder || localize('com_ui_select')}
        disabled={disabled}
        aria-label={ariaLabel}
      >
        {isUnknownValue && <Select.Item value={value}>{value}</Select.Item>}
        {options.map((option) => (
          <Select.Item key={option.value} value={option.value}>
            {option.label}
          </Select.Item>
        ))}
      </Select>
    </div>
  );
}
