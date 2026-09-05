import { useCallback, useState, useRef, useEffect } from 'react';
import type * as t from '@/types';
import {
  PREVIOUS_IDENTITY_HINT_KEY,
  withPreviousIdentityHint,
  stripUntouchedSecretRecordContainers,
} from '@/utils';
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

function nonEmptyString(value: t.ConfigValue): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
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
  editSessionId,
  identityKey,
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

  // Records each entry's identity value (`name`/`group`) the first time it is
  // edited this session, so a later rename in the same edit can still be
  // traced back to it. `null` is a distinct, explicit value here — see
  // `withPreviousIdentityHint`'s doc comment. Captured lazily inside
  // `handleEntryChange` rather than unconditionally during render: a plain
  // object (not React state) mutated during render is read by React
  // internals across the current and work-in-progress trees, so a render
  // that gets interrupted or retried with different props could leave it
  // holding a value from a render that never committed. An event handler has
  // no such race — it only ever runs against the props/state that actually
  // committed.
  //
  // A save, reset, restore, discard, scope change, or conflict rebase all
  // bump `editSessionId` — the array below it is now a fresh baseline, not a
  // continuation of what was open before, so this cache (keyed by a stable
  // key that itself resets on remount) must not survive across the boundary.
  // Rather than clear it with a render-time ref write — safe for the
  // documented `setState`-during-render pattern, but refs have no such
  // guarantee under an interrupted/retried render — the call sites key
  // `<ArrayObjectField key={editSessionId}>` on this same id, so React fully
  // remounts the component (fresh refs and state, no manual reset needed)
  // exactly when a session boundary is crossed.
  const originalIdentityRef = useRef<Map<number, string | null>>(new Map());

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
    // Stamped explicitly, not left absent: an absent hint falls back to
    // bare-identity matching, which would let this new entry inherit an
    // existing entry's credentials merely by being given the same name
    // later in this same session (e.g. reusing a name just freed by
    // deleting that other entry) — see `withPreviousIdentityHint`.
    const blank: t.ConfigValue = identityKey ? { [PREVIOUS_IDENTITY_HINT_KEY]: null } : {};
    // Surviving entries are copied forward verbatim by this structural add —
    // strip any redacted credential-record placeholder left on them by a
    // read, or resubmitting it here would erase that entry's real secret.
    onChange([
      blank,
      ...items.map((item) => stripUntouchedSecretRecordContainers(item, fields)),
    ]);
  }, [items, onChange, identityKey, fields]);

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
      onChange(
        items
          .filter((_, i) => i !== index)
          .map((item) => stripUntouchedSecretRecordContainers(item, fields)),
      );
    },
    [items, onChange, fields],
  );

  const handleEntryChange = useCallback(
    (index: number, newValue: t.ConfigValue) => {
      let hinted = newValue;
      if (identityKey) {
        const stableKey = keys[index];
        if (stableKey != null && !originalIdentityRef.current.has(stableKey)) {
          const currentItem = items[index];
          const currentRecord =
            currentItem && typeof currentItem === 'object' && !Array.isArray(currentItem)
              ? (currentItem as Record<string, t.ConfigValue>)
              : undefined;
          // A remount (e.g. switching tabs and back) within the same edit
          // session throws away this component instance's origin map, but
          // `editedValues` — and so `currentItem` — is unaffected: if an
          // earlier edit already attached a hint (a rename's real origin, or
          // the explicit "no origin" marker from creation), it's still
          // sitting right there on the entry. Prefer it over the entry's
          // current identity, or a fresh mount would "recapture" the
          // already-renamed value (or manufacture an origin for a brand-new
          // entry) as if it were the true origin, permanently losing the
          // real signal.
          //
          // An entry with neither an embedded hint nor an existing identity
          // (a pre-existing stored row saved blank, or a row edited before
          // ever being named) caches `null`, not "leave uncached": once this
          // entry IS given a name later in the same edit, an uncached slot
          // would fall through to treating that brand-new name as if it were
          // this entry's own long-standing identity — the same ambiguity a
          // stamped-null brand-new entry closes, just reached by editing an
          // existing identity-less row instead of adding a new one. `get`
          // returning `undefined` after this point means only "capture
          // hasn't run yet," never "there's genuinely nothing to restore."
          const embeddedHint = currentRecord?.[PREVIOUS_IDENTITY_HINT_KEY];
          const origin =
            embeddedHint === null
              ? null
              : nonEmptyString(embeddedHint) ?? nonEmptyString(currentRecord?.[identityKey]) ?? null;
          originalIdentityRef.current.set(stableKey, origin);
        }
        hinted = withPreviousIdentityHint(
          newValue,
          stableKey != null ? originalIdentityRef.current.get(stableKey) : undefined,
        );
      }
      if (onEntryChange) {
        onEntryChange(index, hinted);
        return;
      }
      const next = [...items];
      next[index] = hinted;
      onChange(next);
    },
    [items, onChange, onEntryChange, identityKey, keys],
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
          editSessionId={editSessionId}
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
