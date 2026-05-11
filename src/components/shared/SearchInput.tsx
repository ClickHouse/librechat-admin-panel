import { SearchField } from '@clickhouse/click-ui';
import type * as t from '@/types';

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
  ariaLabel,
}: t.SearchInputProps) {
  return (
    <div className={`cui-field ${className ?? ''}`} style={{ maxWidth: 400 }}>
      <SearchField
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
    </div>
  );
}
