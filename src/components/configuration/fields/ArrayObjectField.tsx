import { useCallback, useState, useRef, useEffect } from 'react';
import type * as t from '@/types';
import { ObjectEntryCard } from './ObjectEntryCard';
import { AddItemButton } from '@/components/shared';
import { useLocalize } from '@/hooks';

function getEntryLabel(item: t.ConfigValue): string | null {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const obj = item as Record<string, t.ConfigValue>;
    if (typeof obj.name === 'string' && obj.name) return obj.name;
    if (typeof obj.label === 'string' && obj.label) return obj.label;
    if (typeof obj.group === 'string' && obj.group) return obj.group;
  }
  return null;
}

export function ArrayObjectField({
  id,
  value,
  fields,
  onChange,
  onEntryChange,
  disabled,
  hideAddButton,
  addTriggerRef,
  renderFields,
  entryIdPrefix,
}: t.ArrayObjectFieldProps) {
  const localize = useLocalize();
  const items = Array.isArray(value) ? (value as t.ConfigValue[]) : [];

  // Stable keys: assign a unique id to each item position so React can
  // correctly track new vs existing entries when items are prepended.
  const counterRef = useRef(items.length);
  const [keys, setKeys] = useState<number[]>(() => items.map((_, i) => i));
  // Track which key was just added so it auto-expands.
  // Using a ref avoids re-render timing issues: the parent's onChange
  // round-trip may take multiple renders, and a state-based expandedKey
  // would be cleared by effects before the card mounts.
  const expandedKeyRef = useRef<number | null>(null);
  // Guard: when true, skip the sync effect for one cycle (handleAdd
  // already prepended the key; we wait for the parent's items to catch up).
  const addingRef = useRef(false);

  // Sync keys array length with items (handles external changes like
  // save/re-fetch). Skipped right after handleAdd since keys were already
  // prepended locally and items will arrive next render.
  useEffect(() => {
    if (addingRef.current) {
      addingRef.current = false;
      return;
    }
    setKeys((prev) => {
      if (prev.length === items.length) return prev;
      return items.map((_, i) => (i < prev.length ? prev[i] : counterRef.current++));
    });
  }, [items.length]);

  const handleAdd = useCallback(() => {
    const newKey = counterRef.current++;
    addingRef.current = true;
    setKeys((prev) => [newKey, ...prev]);
    expandedKeyRef.current = newKey;
    onChange([{}, ...items]);
  }, [items, onChange]);

  // Expose add trigger to parent (e.g. NestedGroup / section header button)
  useEffect(() => {
    if (addTriggerRef) {
      addTriggerRef.current = handleAdd;
      return () => {
        addTriggerRef.current = null;
      };
    }
  }, [addTriggerRef, handleAdd]);

  const handleRemove = useCallback(
    (index: number) => {
      setKeys((prev) => prev.filter((_, i) => i !== index));
      onChange(items.filter((_, i) => i !== index));
    },
    [items, onChange],
  );

  const handleEntryChange = useCallback(
    (index: number, newValue: t.ConfigValue) => {
      if (onEntryChange) {
        onEntryChange(index, newValue);
        return;
      }
      const next = [...items];
      next[index] = newValue;
      onChange(next);
    },
    [items, onChange, onEntryChange],
  );

  return (
    <div id={id} className="flex w-full flex-col gap-2">
      {!disabled && !hideAddButton && (
        <AddItemButton
          label={localize('com_ui_add_item', { item: localize('com_ui_entry') })}
          onClick={handleAdd}
        />
      )}
      {items.map((item, index) => (
        <ObjectEntryCard
          key={keys[index] ?? index}
          id={entryIdPrefix ? `${entryIdPrefix}-${index}` : undefined}
          entryKey={getEntryLabel(item) ?? localize('com_config_entry_n', { n: String(index + 1) })}
          fields={fields}
          value={item}
          onValueChange={(v) => handleEntryChange(index, v)}
          onRemove={disabled ? undefined : () => handleRemove(index)}
          disabled={disabled}
          defaultExpanded={keys[index] === expandedKeyRef.current}
          renderFields={renderFields}
        />
      ))}
      {items.length === 0 && !hideAddButton && (
        <p className="py-2 text-sm text-(--cui-color-text-muted)">
          {localize('com_config_no_entries')}
        </p>
      )}
    </div>
  );
}
