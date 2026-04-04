import { Select } from '@clickhouse/click-ui';
import { useRef, useCallback, useLayoutEffect } from 'react';
import type * as t from '@/types';
import { AddItemButton, TrashButton } from '@/components/shared';
import { useLocalize } from '@/hooks';

const DEFAULT_TYPES: t.KVValueType[] = ['string', 'number', 'boolean'];
const TYPE_LABELS: Record<t.KVValueType, string> = {
  string: 'abc',
  number: '123',
  boolean: 'T/F',
  json: '{ }',
};

function AutoResizeTextarea({
  value,
  onChange,
  placeholder,
  disabled,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useLayoutEffect(resize, [value, resize]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={resize}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      rows={1}
      className="config-input w-full resize-none overflow-hidden font-mono text-xs"
    />
  );
}

export function KeyValueField({
  id,
  pairs,
  onChange,
  disabled,
  valueTypes,
  keyPlaceholder,
  valuePlaceholder,
  'aria-label': ariaLabel,
}: t.KeyValueFieldProps) {
  const localize = useLocalize();
  const availableTypes = valueTypes ?? DEFAULT_TYPES;
  const listRef = useRef<HTMLDivElement>(null);
  const focusLastKeyRef = useRef(false);

  useLayoutEffect(() => {
    if (focusLastKeyRef.current) {
      focusLastKeyRef.current = false;
      const rows = listRef.current?.querySelectorAll<HTMLElement>('[role="listitem"]');
      const lastRow = rows?.[rows.length - 1];
      lastRow?.querySelector<HTMLInputElement>('input')?.focus();
    }
  });

  const handleAdd = () => {
    onChange([...pairs, { key: '', value: '', valueType: availableTypes[0] }]);
    focusLastKeyRef.current = true;
  };
  const handleRemove = (index: number) => onChange(pairs.filter((_, i) => i !== index));
  const handleChange = (index: number, field: 'key' | 'value', newValue: string) => {
    const next = [...pairs];
    next[index] = { ...next[index], [field]: newValue };
    onChange(next);
  };
  const handleTypeChange = (index: number, newType: t.KVValueType) => {
    const next = [...pairs];
    const pair = next[index];
    let coerced = pair.value;
    if (newType === 'boolean') {
      coerced = pair.value === 'true' || pair.value === '1' ? 'true' : 'false';
    }
    next[index] = { ...pair, value: coerced, valueType: newType };
    onChange(next);
  };

  const renderPrimitiveRow = (vType: t.KVValueType, pair: t.KeyValuePair, index: number) => {
    const valueLabel = `${localize('com_ui_value')} ${index + 1}`;
    return (
      <div className="flex items-center gap-2" role="listitem">
        <input
          type="text"
          value={pair.key}
          onChange={(e) => handleChange(index, 'key', e.target.value)}
          placeholder={keyPlaceholder ?? localize('com_ui_key')}
          disabled={disabled}
          aria-label={`${localize('com_ui_key')} ${index + 1}`}
          className="config-input max-w-37.5 flex-1"
        />
        {vType === 'boolean' ? (
          <div className="select-field-a11y flex-2">
            <Select
              value={pair.value === 'true' ? 'true' : 'false'}
              onSelect={(v) => handleChange(index, 'value', v)}
              disabled={disabled}
              aria-label={valueLabel}
            >
              <Select.Item value="true">true</Select.Item>
              <Select.Item value="false">false</Select.Item>
            </Select>
          </div>
        ) : (
          <input
            type={vType === 'number' ? 'number' : 'text'}
            value={pair.value}
            onChange={(e) => handleChange(index, 'value', e.target.value)}
            placeholder={valuePlaceholder ?? localize('com_ui_value')}
            disabled={disabled}
            aria-label={valueLabel}
            className="config-input flex-2"
          />
        )}
        {!disabled && availableTypes.length > 1 && (
          <div className="select-field-a11y w-20 shrink-0">
            <Select
              value={vType}
              onSelect={(v) => handleTypeChange(index, v as t.KVValueType)}
              aria-label={`${localize('com_config_field_type')} ${index + 1}`}
            >
              {availableTypes.map((vt) => (
                <Select.Item key={vt} value={vt}>
                  {TYPE_LABELS[vt]}
                </Select.Item>
              ))}
            </Select>
          </div>
        )}
        {!disabled && (
          <TrashButton
            onClick={() => handleRemove(index)}
            ariaLabel={`${localize('com_ui_delete')} ${localize('com_ui_entry')} ${index + 1}`}
          />
        )}
      </div>
    );
  };

  const renderJsonRow = (pair: t.KeyValuePair, index: number) => (
    <div className="flex flex-col gap-1" role="listitem">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={pair.key}
          onChange={(e) => handleChange(index, 'key', e.target.value)}
          placeholder={keyPlaceholder ?? localize('com_ui_key')}
          disabled={disabled}
          aria-label={`${localize('com_ui_key')} ${index + 1}`}
          className="config-input min-w-0 flex-1"
        />
        {!disabled && availableTypes.length > 1 && (
          <div className="select-field-a11y w-20 shrink-0">
            <Select
              value="json"
              onSelect={(v) => handleTypeChange(index, v as t.KVValueType)}
              aria-label={`${localize('com_config_field_type')} ${index + 1}`}
            >
              {availableTypes.map((vt) => (
                <Select.Item key={vt} value={vt}>
                  {TYPE_LABELS[vt]}
                </Select.Item>
              ))}
            </Select>
          </div>
        )}
        {!disabled && (
          <TrashButton
            onClick={() => handleRemove(index)}
            ariaLabel={`${localize('com_ui_delete')} ${localize('com_ui_entry')} ${index + 1}`}
          />
        )}
      </div>
      <AutoResizeTextarea
        value={pair.value}
        onChange={(v) => handleChange(index, 'value', v)}
        placeholder='{"key": "value"}'
        disabled={disabled}
        aria-label={`${localize('com_ui_value')} ${index + 1}`}
      />
    </div>
  );

  return (
    <div
      ref={listRef}
      id={id}
      className="flex w-full max-w-150 flex-col gap-2"
      role="list"
      aria-label={ariaLabel}
    >
      {pairs.map((pair, index) => {
        const vType = pair.valueType ?? 'string';
        return vType === 'json'
          ? renderJsonRow(pair, index)
          : renderPrimitiveRow(vType, pair, index);
      })}

      {!disabled && (
        <AddItemButton
          label={localize('com_ui_add_item', { item: localize('com_ui_entry') })}
          onClick={handleAdd}
        />
      )}
    </div>
  );
}
