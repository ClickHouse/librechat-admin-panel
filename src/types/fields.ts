import type { ReactNode } from 'react';
import type React from 'react';
import type { ConfigValue, SchemaField, SelectOption, KeyValuePair, KVValueType } from './config';

export interface SelectFieldProps {
  id: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  'aria-label'?: string;
}

export interface KeyValueFieldProps {
  id: string;
  pairs: KeyValuePair[];
  onChange: (pairs: KeyValuePair[]) => void;
  disabled?: boolean;
  valueTypes?: KVValueType[];
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  'aria-label'?: string;
}

export interface TextFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  type?: 'text' | 'url' | 'email';
  'aria-label'?: string;
  'aria-describedby'?: string;
}

export interface TextareaFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

export interface ToggleFieldProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  'aria-label'?: string;
}

export interface NumberFieldProps {
  id: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  placeholder?: string;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

export interface NumberListFieldProps {
  id: string;
  values: number[];
  onChange: (values: number[]) => void;
  disabled?: boolean;
  placeholder?: string;
  itemLabel?: string;
}

export interface ListFieldProps {
  id: string;
  values: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
  itemLabel?: string;
  variant?: 'inline-edit' | 'display';
  options?: SelectOption[];
  'aria-label'?: string;
}

export interface CodeFieldProps {
  id: string;
  value: ConfigValue;
  onChange: (value: ConfigValue) => void;
  disabled?: boolean;
  'aria-label'?: string;
}

export interface ArrayObjectFieldProps {
  id: string;
  value: ConfigValue;
  fields: SchemaField[];
  onChange: (value: ConfigValue) => void;
  disabled?: boolean;
  /** Hide the bottom "Add entry" button (e.g. when add is in the section header). */
  hideAddButton?: boolean;
  /** Ref that gets populated with a function to add a new entry. */
  addTriggerRef?: React.MutableRefObject<(() => void) | null>;
  renderFields: CollectionRenderFields;
  /** When set, each entry card gets an id of `{entryIdPrefix}-{index}` for TOC scroll targets. */
  entryIdPrefix?: string;
}

export interface RecordObjectFieldProps {
  id: string;
  value: ConfigValue;
  fields: SchemaField[];
  onChange: (value: ConfigValue) => void;
  disabled?: boolean;
  allowPrimitiveValues?: boolean;
  /** Ref that gets populated with a function to open the add-key input. */
  addTriggerRef?: React.MutableRefObject<(() => void) | null>;
  renderFields: CollectionRenderFields;
}

export type CollectionRenderFields = (
  fields: SchemaField[],
  parentValue: ConfigValue,
  parentPath: string,
  onChange: (path: string, value: ConfigValue) => void,
  /** Optional ref populated with a trigger to open the "add field" dropdown. */
  addFieldTriggerRef?: React.MutableRefObject<(() => void) | null>,
) => React.ReactNode;

export interface ObjectEntryCardProps {
  id?: string;
  entryKey: string;
  fields: SchemaField[];
  value: ConfigValue;
  onValueChange: (value: ConfigValue) => void;
  onRemove?: () => void;
  onRename?: (newKey: string) => void;
  disabled?: boolean;
  defaultExpanded?: boolean;
  renderFields: CollectionRenderFields;
}

export interface SwitchObjectFieldProps {
  id: string;
  value: ConfigValue;
  onChange: (value: ConfigValue) => void;
  disabled?: boolean;
  children: ReactNode;
  'aria-label'?: string;
}

export interface TextRecordFieldProps {
  id: string;
  value: ConfigValue;
  onChange: (value: ConfigValue) => void;
  disabled?: boolean;
  variant: 'record' | 'array';
  'aria-label'?: string;
}

export interface ListRecordFieldProps {
  id: string;
  value: ConfigValue;
  onChange: (value: ConfigValue) => void;
  disabled?: boolean;
  'aria-label'?: string;
}
