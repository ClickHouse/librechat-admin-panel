import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type * as t from '@/types';
import { ObjectEntryCard } from './ObjectEntryCard';
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
}));

const entryFields: t.SchemaField[] = [
  createField({ key: 'name', type: 'string' }),
  createField({ key: 'baseURL', type: 'string' }),
  createField({ key: 'headers', type: 'record', recordValueType: 'primitive' }),
];

function stubRenderFields(
  onChangeKey: string,
  onChangeValue: t.ConfigValue,
): t.CollectionRenderFields {
  return (_fields, _parentValue, _entryKey, onChange) => (
    <button onClick={() => onChange(onChangeKey, onChangeValue)}>trigger</button>
  );
}

describe('ObjectEntryCard — credential-record container preservation', () => {
  it('omits an untouched credential-record container when an unrelated field is edited', () => {
    const onValueChange = vi.fn();
    render(
      <ObjectEntryCard
        entryKey="OpenRouter"
        fields={entryFields}
        value={{ name: 'OpenRouter', baseURL: 'https://old', headers: {} }}
        onValueChange={onValueChange}
        renderFields={stubRenderFields('baseURL', 'https://new')}
        defaultExpanded
      />,
    );
    fireEvent.click(screen.getByText('trigger'));
    expect(onValueChange).toHaveBeenCalledTimes(1);
    const submitted = onValueChange.mock.calls[0][0] as Record<string, t.ConfigValue>;
    expect(submitted).toEqual({ name: 'OpenRouter', baseURL: 'https://new' });
    expect(Object.hasOwn(submitted, 'headers')).toBe(false);
  });

  it('keeps a credential-record container the admin actually edited, even once emptied', () => {
    const onValueChange = vi.fn();
    render(
      <ObjectEntryCard
        entryKey="OpenRouter"
        fields={entryFields}
        value={{ name: 'OpenRouter', baseURL: 'https://old', headers: {} }}
        onValueChange={onValueChange}
        renderFields={stubRenderFields('headers', [])}
        defaultExpanded
      />,
    );
    fireEvent.click(screen.getByText('trigger'));
    const submitted = onValueChange.mock.calls[0][0] as Record<string, t.ConfigValue>;
    expect(submitted).toEqual({ name: 'OpenRouter', baseURL: 'https://old', headers: [] });
  });

  it('does not mask a record field that is not a registered credential container', () => {
    const fieldsWithPlainRecord = [
      ...entryFields,
      createField({ key: 'metadata', type: 'record', recordValueType: 'primitive' }),
    ];
    const onValueChange = vi.fn();
    render(
      <ObjectEntryCard
        entryKey="OpenRouter"
        fields={fieldsWithPlainRecord}
        value={{ name: 'OpenRouter', baseURL: 'https://old', metadata: { a: 'b' } }}
        onValueChange={onValueChange}
        renderFields={stubRenderFields('baseURL', 'https://new')}
        defaultExpanded
      />,
    );
    fireEvent.click(screen.getByText('trigger'));
    const submitted = onValueChange.mock.calls[0][0] as Record<string, t.ConfigValue>;
    expect(submitted).toEqual({
      name: 'OpenRouter',
      baseURL: 'https://new',
      metadata: { a: 'b' },
    });
  });

  it('stays omitted across a further unrelated edit once a container is already absent', () => {
    const onValueChange = vi.fn();
    render(
      <ObjectEntryCard
        entryKey="OpenRouter"
        fields={entryFields}
        value={{ name: 'OpenRouter', baseURL: 'https://old' }}
        onValueChange={onValueChange}
        renderFields={stubRenderFields('name', 'Renamed')}
        defaultExpanded
      />,
    );
    fireEvent.click(screen.getByText('trigger'));
    const submitted = onValueChange.mock.calls[0][0] as Record<string, t.ConfigValue>;
    expect(submitted).toEqual({ name: 'Renamed', baseURL: 'https://old' });
    expect(Object.hasOwn(submitted, 'headers')).toBe(false);
  });
});
