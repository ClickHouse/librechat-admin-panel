import { Checkbox } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useLocalize } from '@/hooks';

export function EnumSetField({
  id,
  value,
  options,
  onChange,
  defaultValue,
  disabled,
  'aria-label': ariaLabel,
}: t.EnumSetFieldProps) {
  const localize = useLocalize();
  const checked = new Set(value ?? defaultValue ?? []);
  const selectedCount = options.reduce((n, opt) => n + (checked.has(opt.value) ? 1 : 0), 0);

  const handleToggle = (optionValue: string) => {
    const next = new Set(checked);
    if (next.has(optionValue)) {
      next.delete(optionValue);
    } else {
      next.add(optionValue);
    }
    onChange(options.filter((opt) => next.has(opt.value)).map((opt) => opt.value));
  };

  return (
    <div
      id={id}
      role="group"
      aria-label={ariaLabel}
      className="flex w-full max-w-100 flex-col gap-1.5"
    >
      <span className="text-xs text-(--cui-color-text-muted)">
        {localize('com_config_enum_selected_count', {
          selected: selectedCount,
          total: options.length,
        })}
      </span>
      {options.map((opt) => (
        <Checkbox
          key={opt.value}
          label={opt.label}
          checked={checked.has(opt.value)}
          disabled={disabled}
          onCheckedChange={() => handleToggle(opt.value)}
        />
      ))}
    </div>
  );
}
