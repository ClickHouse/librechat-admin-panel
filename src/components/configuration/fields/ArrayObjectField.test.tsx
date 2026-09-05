import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type * as t from '@/types';
import { ArrayObjectField } from './ArrayObjectField';
import { createField } from '@/test/fixtures';

vi.mock('@/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

vi.mock('@clickhouse/click-ui', () => ({
  Icon: () => null,
  IconButton: ({
    onClick,
    'aria-label': ariaLabel,
  }: {
    onClick?: () => void;
    'aria-label'?: string;
  }) => <button onClick={onClick} aria-label={ariaLabel} />,
  Button: ({ label, onClick }: { label?: string; onClick?: () => void }) => (
    <button onClick={onClick}>{label}</button>
  ),
}));

const entryFields: t.SchemaField[] = [
  createField({ key: 'name', type: 'string' }),
  createField({ key: 'baseURL', type: 'string' }),
];

/** Renders one button per entry that renames it to `newValue` when clicked. */
const renderRenameButton: t.CollectionRenderFields = (_fields, _parentValue, entryKey, onChange) => (
  <button onClick={() => onChange('name', 'renamed')}>rename-{entryKey}</button>
);

/** Renders one button per entry that edits an unrelated field (baseURL). */
const renderUnrelatedEditButton: t.CollectionRenderFields = (
  _fields,
  _parentValue,
  entryKey,
  onChange,
) => <button onClick={() => onChange('baseURL', 'https://new')}>edit-{entryKey}</button>;

/** ObjectEntryCard only calls renderFields once its card is expanded. */
function expandEntry(label: string) {
  fireEvent.click(screen.getByText(label).closest('[role="button"]') as HTMLElement);
}

describe('ArrayObjectField — __previousIdentity hint for renamed entries', () => {
  it('attaches the original identity when the identity field is renamed', () => {
    const onEntryChange = vi.fn();
    render(
      <ArrayObjectField
        id="custom"
        value={[{ name: 'OpenRouter', baseURL: 'https://old' }]}
        fields={entryFields}
        onChange={vi.fn()}
        onEntryChange={onEntryChange}
        renderFields={renderRenameButton}
        identityKey="name"
      />,
    );
    expandEntry('OpenRouter');
    fireEvent.click(screen.getByText('rename-OpenRouter'));
    expect(onEntryChange).toHaveBeenCalledWith(0, {
      name: 'renamed',
      baseURL: 'https://old',
      __previousIdentity: 'OpenRouter',
    });
  });

  it('also attaches the hint on an unrelated field edit, unchanged from the current identity', () => {
    const onEntryChange = vi.fn();
    render(
      <ArrayObjectField
        id="custom"
        value={[{ name: 'OpenRouter', baseURL: 'https://old' }]}
        fields={entryFields}
        onChange={vi.fn()}
        onEntryChange={onEntryChange}
        renderFields={renderUnrelatedEditButton}
        identityKey="name"
      />,
    );
    expandEntry('OpenRouter');
    fireEvent.click(screen.getByText('edit-OpenRouter'));
    expect(onEntryChange).toHaveBeenCalledWith(0, {
      name: 'OpenRouter',
      baseURL: 'https://new',
      __previousIdentity: 'OpenRouter',
    });
  });

  it('does not attach a hint when identityKey is not provided', () => {
    const onEntryChange = vi.fn();
    render(
      <ArrayObjectField
        id="custom"
        value={[{ name: 'OpenRouter', baseURL: 'https://old' }]}
        fields={entryFields}
        onChange={vi.fn()}
        onEntryChange={onEntryChange}
        renderFields={renderRenameButton}
      />,
    );
    expandEntry('OpenRouter');
    fireEvent.click(screen.getByText('rename-OpenRouter'));
    expect(onEntryChange).toHaveBeenCalledWith(0, { name: 'renamed', baseURL: 'https://old' });
  });

  it('stamps an explicit null origin for a pre-existing identity-less entry named for the first time', () => {
    // A stored row with no name at all (e.g. saved blank in an earlier
    // session) is wire-identical, at the moment it's first edited, to a
    // brand-new entry added this session — neither has an embedded hint nor
    // a current identity. Both must resolve to the same explicit "no
    // origin" signal, or naming this row later in the same edit would let
    // it fall back to bare-identity matching and inherit another entry's
    // credentials merely by ending up with that entry's freed name.
    const onEntryChange = vi.fn();
    render(
      <ArrayObjectField
        id="custom"
        value={[{}]}
        fields={entryFields}
        onChange={vi.fn()}
        onEntryChange={onEntryChange}
        renderFields={renderRenameButton}
        identityKey="name"
      />,
    );
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByText(/^rename-/));
    expect(onEntryChange).toHaveBeenCalledWith(0, {
      name: 'renamed',
      __previousIdentity: null,
    });
  });

  it('keeps the true original identity across a second rename in the same session', () => {
    const onEntryChange = vi.fn();
    const { rerender } = render(
      <ArrayObjectField
        id="custom"
        value={[{ name: 'OpenRouter', baseURL: 'https://old' }]}
        fields={entryFields}
        onChange={vi.fn()}
        onEntryChange={onEntryChange}
        renderFields={renderRenameButton}
        identityKey="name"
      />,
    );
    expandEntry('OpenRouter');
    fireEvent.click(screen.getByText('rename-OpenRouter'));
    expect(onEntryChange).toHaveBeenLastCalledWith(0, {
      name: 'renamed',
      baseURL: 'https://old',
      __previousIdentity: 'OpenRouter',
    });

    // The parent applies the first rename and re-renders with the new name.
    rerender(
      <ArrayObjectField
        id="custom"
        value={[{ name: 'renamed', baseURL: 'https://old' }]}
        fields={entryFields}
        onChange={vi.fn()}
        onEntryChange={onEntryChange}
        renderFields={renderRenameButton}
        identityKey="name"
      />,
    );
    fireEvent.click(screen.getByText('rename-renamed'));
    expect(onEntryChange).toHaveBeenLastCalledWith(0, {
      name: 'renamed',
      baseURL: 'https://old',
      __previousIdentity: 'OpenRouter',
    });
  });

  it('keeps the correct original identity for an existing entry after a sibling is prepended via Add entry', () => {
    const onEntryChange = vi.fn();
    const onChange = vi.fn();
    const initialValue = [
      { name: 'OpenRouter', baseURL: 'https://old' },
      { name: 'Anyscale', baseURL: 'https://anyscale' },
    ];
    const { rerender } = render(
      <ArrayObjectField
        id="custom"
        value={initialValue}
        fields={entryFields}
        onChange={onChange}
        onEntryChange={onEntryChange}
        renderFields={renderRenameButton}
        identityKey="name"
      />,
    );

    expandEntry('OpenRouter');

    // Real "Add entry" flow: prepends a blank entry, shifting OpenRouter from
    // index 0 to 1 and Anyscale from 1 to 2 — exercises the same key-sync
    // path a real add goes through, unlike directly swapping the value prop.
    fireEvent.click(screen.getByText('com_ui_add_item'));
    expect(onChange).toHaveBeenCalledWith([{ __previousIdentity: null }, ...initialValue]);
    rerender(
      <ArrayObjectField
        id="custom"
        value={onChange.mock.calls[0][0]}
        fields={entryFields}
        onChange={onChange}
        onEntryChange={onEntryChange}
        renderFields={renderRenameButton}
        identityKey="name"
      />,
    );

    fireEvent.click(screen.getByText('rename-OpenRouter'));
    expect(onEntryChange).toHaveBeenCalledWith(1, {
      name: 'renamed',
      baseURL: 'https://old',
      __previousIdentity: 'OpenRouter',
    });
  });

  it('captures a fresh origin for the next session instead of reusing a stale hint from a completed save', () => {
    // Session 1: rename OpenRouter -> OpenRouter EU, save succeeds. Session 2
    // (editSessionId bumped, value refetched to reflect the save): rename
    // OpenRouter EU -> OpenRouter US. The hint must be "OpenRouter EU" — the
    // entry's real predecessor this session — not the stale "OpenRouter"
    // from before the save, which the backend can no longer find at all.
    //
    // The real call sites key `<ArrayObjectField key={editSessionId}>` so
    // React fully remounts on a session change — `rerender` alone (same
    // instance) wouldn't exercise that, so this simulates the remount with
    // unmount+render instead, same as the test below.
    const onEntryChange = vi.fn();
    const { unmount } = render(
      <ArrayObjectField
        id="custom"
        value={[{ name: 'OpenRouter', baseURL: 'https://old' }]}
        fields={entryFields}
        onChange={vi.fn()}
        onEntryChange={onEntryChange}
        renderFields={renderRenameButton}
        identityKey="name"
        editSessionId={0}
      />,
    );
    expandEntry('OpenRouter');
    fireEvent.click(screen.getByText('rename-OpenRouter'));
    expect(onEntryChange).toHaveBeenLastCalledWith(0, {
      name: 'renamed',
      baseURL: 'https://old',
      __previousIdentity: 'OpenRouter',
    });
    unmount();

    // Save succeeds: ConfigPage refetches, bumps editSessionId (remounting
    // the keyed component), and the fresh baseline reflects the post-save
    // name — a genuine server read, not a surviving draft, so it carries no
    // embedded hint of its own.
    render(
      <ArrayObjectField
        id="custom"
        value={[{ name: 'OpenRouter EU', baseURL: 'https://old' }]}
        fields={entryFields}
        onChange={vi.fn()}
        onEntryChange={onEntryChange}
        renderFields={renderRenameButton}
        identityKey="name"
        editSessionId={1}
      />,
    );
    expandEntry('OpenRouter EU');
    fireEvent.click(screen.getByText('rename-OpenRouter EU'));
    expect(onEntryChange).toHaveBeenLastCalledWith(0, {
      name: 'renamed',
      baseURL: 'https://old',
      __previousIdentity: 'OpenRouter EU',
    });
  });

  it('recovers the true origin from an already-embedded hint after a remount within the same session', () => {
    // Switching config tabs and back unmounts and remounts ArrayObjectField
    // without bumping editSessionId — a genuinely different trigger from the
    // save/reset/restore/discard boundary above. The origin map starts empty
    // again, but the draft value itself (from editedValues, unaffected by
    // the remount) already carries the real origin as __previousIdentity —
    // recapturing from the entry's current (already-renamed) name instead
    // would silently replace the correct hint with a wrong one.
    const onEntryChange = vi.fn();
    const { unmount } = render(
      <ArrayObjectField
        id="custom"
        value={[{ name: 'OpenRouter', baseURL: 'https://old' }]}
        fields={entryFields}
        onChange={vi.fn()}
        onEntryChange={onEntryChange}
        renderFields={renderRenameButton}
        identityKey="name"
        editSessionId={0}
      />,
    );
    expandEntry('OpenRouter');
    fireEvent.click(screen.getByText('rename-OpenRouter'));
    expect(onEntryChange).toHaveBeenLastCalledWith(0, {
      name: 'renamed',
      baseURL: 'https://old',
      __previousIdentity: 'OpenRouter',
    });
    unmount();

    // Tab switch and back: fresh component instance, same session, and the
    // parent's draft value already has the previous edit's hint embedded.
    render(
      <ArrayObjectField
        id="custom"
        value={[{ name: 'renamed', baseURL: 'https://old', __previousIdentity: 'OpenRouter' }]}
        fields={entryFields}
        onChange={vi.fn()}
        onEntryChange={onEntryChange}
        renderFields={renderUnrelatedEditButton}
        identityKey="name"
        editSessionId={0}
      />,
    );
    expandEntry('renamed');
    fireEvent.click(screen.getByText('edit-renamed'));
    expect(onEntryChange).toHaveBeenLastCalledWith(0, {
      name: 'renamed',
      baseURL: 'https://new',
      __previousIdentity: 'OpenRouter',
    });
  });
});

describe('ArrayObjectField — strips untouched secret-record containers on structural edits', () => {
  const fieldsWithHeaders: t.SchemaField[] = [
    ...entryFields,
    createField({ key: 'headers', type: 'record', recordValueType: 'primitive' }),
  ];

  it('strips a redacted headers placeholder from a surviving entry when adding a new one', () => {
    const onChange = vi.fn();
    render(
      <ArrayObjectField
        id="custom"
        value={[{ name: 'OpenRouter', baseURL: 'https://old', headers: {} }]}
        fields={fieldsWithHeaders}
        onChange={onChange}
        renderFields={renderRenameButton}
      />,
    );
    fireEvent.click(screen.getByText('com_ui_add_item'));
    expect(onChange).toHaveBeenCalledWith([{}, { name: 'OpenRouter', baseURL: 'https://old' }]);
  });

  it('strips a redacted headers placeholder from a surviving entry when removing another', () => {
    const onChange = vi.fn();
    render(
      <ArrayObjectField
        id="custom"
        value={[
          { name: 'OpenRouter', baseURL: 'https://old', headers: {} },
          { name: 'Anyscale', baseURL: 'https://anyscale' },
        ]}
        fields={fieldsWithHeaders}
        onChange={onChange}
        renderFields={renderRenameButton}
      />,
    );
    fireEvent.click(screen.getAllByLabelText(/com_ui_delete/)[1]);
    expect(onChange).toHaveBeenCalledWith([{ name: 'OpenRouter', baseURL: 'https://old' }]);
  });

  it('keeps a headers container the admin actually edited (array-shaped, even if emptied)', () => {
    const onChange = vi.fn();
    render(
      <ArrayObjectField
        id="custom"
        value={[
          { name: 'OpenRouter', baseURL: 'https://old', headers: [] },
          { name: 'Anyscale', baseURL: 'https://anyscale' },
        ]}
        fields={fieldsWithHeaders}
        onChange={onChange}
        renderFields={renderRenameButton}
      />,
    );
    fireEvent.click(screen.getByText('com_ui_add_item'));
    expect(onChange).toHaveBeenCalledWith([
      {},
      { name: 'OpenRouter', baseURL: 'https://old', headers: [] },
      { name: 'Anyscale', baseURL: 'https://anyscale' },
    ]);
  });
});
