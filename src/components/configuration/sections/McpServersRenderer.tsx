/**
 * Custom section renderer for `mcpServers` — the MCP Servers tab.
 *
 * Renders MCP server entries as expandable cards with:
 *  - Transport-type-aware field visibility (stdio vs sse vs streamable-http vs websocket)
 *  - Semantic field groups (Connection, Authentication, Server Options, Advanced)
 *  - A "Create MCP Server" dialog for adding new entries
 *  - TOC-compatible scroll targets via entry card IDs
 *
 * All edits write per-leaf paths (`mcpServers.<key>.<field>`) into editedValues
 * so single-field reset, baseline-equality dirty pruning, and rename orphan
 * cleanup all work uniformly.
 */

import { Icon } from '@clickhouse/click-ui';
import { memo, useRef, useMemo, useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { YAML_LOCKED_FIELDS, INSPECTOR_DERIVED } from './mcpFieldMeta';
import { useCollapsibleSection } from '../useCollapsibleSection';
import { ObjectEntryCard } from '../fields/ObjectEntryCard';
import { renderCollapsible } from '../renderCollapsible';
import { renderInlineField } from '../FieldRenderer';
import { SelectField } from '../fields/SelectField';
import { FormDialog } from '@/components/shared';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';

// ---------------------------------------------------------------------------
// Transport type → field visibility
// ---------------------------------------------------------------------------

/** Fields specific to each transport type. */
const TRANSPORT_FIELDS: Record<string, string[]> = {
  stdio: ['command', 'args', 'env', 'stderr'],
  sse: ['url', 'headers'],
  'streamable-http': ['url', 'headers'],
  http: ['url', 'headers'],
  websocket: ['url'],
};

/** All transport-specific field keys (union of all TRANSPORT_FIELDS values). */
const ALL_TRANSPORT_KEYS = new Set(Object.values(TRANSPORT_FIELDS).flat());

/** Auth-related fields only shown for remote transports (not stdio). */
const REMOTE_ONLY_FIELDS = new Set(['requiresOAuth', 'apiKey', 'oauth', 'oauth_headers']);

const REMOTE_TRANSPORTS = new Set(['sse', 'streamable-http', 'http', 'websocket']);

/** Fields that require a value depending on transport type. */
const REQUIRED_BY_TRANSPORT: Record<string, Set<string>> = {
  stdio: new Set(['command', 'args']),
  sse: new Set(['url']),
  'streamable-http': new Set(['url']),
  http: new Set(['url']),
  websocket: new Set(['url']),
};

/** Curated transport type options with lowercase labels, excluding `http` alias. */
const TRANSPORT_TYPE_OPTIONS: { label: string; value: string }[] = [
  { label: 'streamable-http', value: 'streamable-http' },
  { label: 'sse', value: 'sse' },
  { label: 'stdio', value: 'stdio' },
  { label: 'websocket', value: 'websocket' },
];

/** The `type` field is always required. */
const ALWAYS_REQUIRED = new Set(['type']);

/**
 * Infer transport type from configured fields, mirroring Zod's union resolution
 * order in MCPOptionsSchema: Stdio → WebSocket → SSE → StreamableHTTP.
 *
 * YAML configs can omit `type` because each transport schema (except
 * streamable-http) provides a default. The backend infers the type from the
 * discriminating fields (command, url protocol). We replicate that here so the
 * UI shows the effective type for existing configs.
 */
function inferTransportType(values: Record<string, t.ConfigValue>): string {
  if (typeof values.type === 'string' && values.type) return values.type;
  if (typeof values.command === 'string' && values.command) return 'stdio';
  if (typeof values.url === 'string' && values.url) {
    try {
      const protocol = new URL(values.url).protocol;
      if (protocol === 'ws:' || protocol === 'wss:') return 'websocket';
    } catch {
      // invalid URL — fall through to sse as default for any url presence
    }
    return 'sse';
  }
  return '';
}

function withFieldOverrides(field: t.SchemaField, transportType: string): t.SchemaField {
  if (ALWAYS_REQUIRED.has(field.key)) {
    return { ...field, isOptional: false };
  }
  const transportRequired = REQUIRED_BY_TRANSPORT[transportType];
  if (transportRequired?.has(field.key)) {
    return { ...field, isOptional: false };
  }
  return field;
}

// ---------------------------------------------------------------------------
// Per-leaf edit overlay helpers
// ---------------------------------------------------------------------------

function setLeaf(
  target: Record<string, t.ConfigValue>,
  segments: string[],
  value: t.ConfigValue,
): void {
  let cursor: Record<string, t.ConfigValue> = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    const next = cursor[seg];
    if (next == null || typeof next !== 'object' || Array.isArray(next)) {
      cursor[seg] = {};
    }
    cursor = cursor[seg] as Record<string, t.ConfigValue>;
  }
  const leaf = segments[segments.length - 1];
  if (value === undefined) {
    delete cursor[leaf];
  } else {
    cursor[leaf] = value;
  }
}

function applyLeafOverlay(
  base: Record<string, t.ConfigValue>,
  leafEdits: Array<[string[], t.ConfigValue]>,
): Record<string, t.ConfigValue> {
  const cloned = deepClone(base);
  for (const [segments, value] of leafEdits) {
    setLeaf(cloned, segments, value);
  }
  return cloned;
}

function deepClone(value: Record<string, t.ConfigValue>): Record<string, t.ConfigValue> {
  const result: Record<string, t.ConfigValue> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      result[k] = deepClone(v as Record<string, t.ConfigValue>);
    } else if (Array.isArray(v)) {
      result[k] = v.slice();
    } else {
      result[k] = v;
    }
  }
  return result;
}

function isPlainObject(value: t.ConfigValue): value is Record<string, t.ConfigValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Walks a nested record and returns one entry per leaf (primitive or array).
 * Used by rename to enumerate every leaf path beneath an MCP entry so nested
 * structures like `headers.Authorization` survive the rename intact instead of
 * collapsing into one whole-object write.
 */
function enumerateLeafPaths(
  obj: Record<string, t.ConfigValue>,
  prefix: string[] = [],
  seen: WeakSet<object> = new WeakSet(),
): Array<{ segments: string[]; value: t.ConfigValue }> {
  if (seen.has(obj)) return [];
  seen.add(obj);
  const out: Array<{ segments: string[]; value: t.ConfigValue }> = [];
  for (const [k, v] of Object.entries(obj)) {
    const next = [...prefix, k];
    if (isPlainObject(v)) {
      out.push(...enumerateLeafPaths(v, next, seen));
    } else {
      out.push({ segments: next, value: v });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Semantic field groups
// ---------------------------------------------------------------------------

interface FieldGroupDef {
  labelKey: string;
  fields: string[];
  defaultExpanded: boolean;
  /** Nested sub-groups rendered inside this group (fields should be empty when using children). */
  children?: FieldGroupDef[];
}

const MCP_FIELD_GROUPS: FieldGroupDef[] = [
  {
    labelKey: 'com_config_group_connection',
    fields: ['type', 'url', 'command', 'args', 'headers', 'env', 'stderr', 'requiresOAuth'],
    defaultExpanded: true,
  },
  {
    labelKey: 'com_config_group_authentication',
    fields: [],
    defaultExpanded: false,
    children: [
      {
        labelKey: 'com_config_group_api_key',
        fields: ['apiKey'],
        defaultExpanded: true,
      },
      {
        labelKey: 'com_config_group_oauth',
        fields: ['oauth', 'oauth_headers'],
        defaultExpanded: false,
      },
    ],
  },
  {
    labelKey: 'com_config_group_server_options',
    fields: [
      'title',
      'description',
      'startup',
      'chatMenu',
      'serverInstructions',
      'timeout',
      'sseReadTimeout',
      'initTimeout',
      'iconPath',
    ],
    defaultExpanded: false,
  },
];

// ---------------------------------------------------------------------------
// FieldGroup — collapsible group within a card (replicates EndpointsRenderer)
// ---------------------------------------------------------------------------

function flattenGroupFields(
  fields: t.SchemaField[],
  parentValue: t.ConfigValue,
  parentPath: string,
  onChange: (path: string, value: t.ConfigValue) => void,
  localize: (key: string, interpolation?: Record<string, string | number>) => string,
  transportType: string,
  disabled?: boolean,
  collectionRenderOverrides?: Record<string, t.CollectionRenderFields>,
  lockedKeys?: Set<string>,
): ReactNode[] {
  const values = isPlainObject(parentValue) ? parentValue : {};

  const nodes: ReactNode[] = [];
  for (const field of fields) {
    const fieldDisabled = disabled || (lockedKeys?.has(field.key) ?? false);
    // Custom render for transport type select — curated options with lowercase labels.
    // When `type` is omitted (common in YAML configs), infer it from other fields
    // to mirror backend Zod union resolution.
    if (field.key === 'type') {
      const fieldId = `${parentPath}-${field.key}`;
      const label = localize(`com_config_field_${field.key}`);
      const explicitValue = typeof values.type === 'string' ? values.type : '';
      const rawValue = explicitValue || inferTransportType(values);
      const displayValue = rawValue === 'http' ? 'streamable-http' : rawValue;
      nodes.push(
        <div key={field.key} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-4">
          <label
            htmlFor={fieldId}
            className="shrink-0 text-sm font-medium text-(--cui-color-text-default) sm:w-35"
          >
            {label}
            <span className="ml-0.5 text-(--cui-color-text-danger)">*</span>
          </label>
          <div className="flex-1">
            <SelectField
              id={fieldId}
              value={displayValue}
              options={TRANSPORT_TYPE_OPTIONS}
              onChange={(v) => onChange(field.key, v)}
              disabled={fieldDisabled}
              aria-label={label}
            />
          </div>
        </div>,
      );
      continue;
    }

    if (field.children && field.children.length > 0 && !field.isArray && field.type !== 'record') {
      const nested = values[field.key];
      const nestedObj = isPlainObject(nested) ? nested : {};
      for (const child of field.children) {
        nodes.push(
          renderInlineField(
            withFieldOverrides(child, transportType),
            nested,
            `${parentPath}.${field.key}`,
            (childKey, childValue) => {
              onChange(field.key, { ...nestedObj, [childKey]: childValue });
            },
            localize,
            fieldDisabled,
            collectionRenderOverrides,
            true,
          ),
        );
      }
    } else {
      nodes.push(
        renderInlineField(
          withFieldOverrides(field, transportType),
          parentValue,
          parentPath,
          onChange,
          localize,
          fieldDisabled,
          collectionRenderOverrides,
          true,
        ),
      );
    }
  }
  return nodes;
}

/** Parent-level collapsible section that wraps child sub-groups. */
function FieldGroupSection({
  labelKey,
  defaultExpanded,
  children,
}: {
  labelKey: string;
  defaultExpanded: boolean;
  children: ReactNode;
}) {
  const localize = useLocalize();
  const { isExpanded, hasEverExpanded, sectionRef, toggle } = useCollapsibleSection({
    defaultExpanded,
  });

  return (
    <section ref={sectionRef} className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-(--cui-color-stroke-default) pb-2">
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={toggle}
          className="flex cursor-pointer items-center gap-2 border-none bg-transparent px-0 select-none"
        >
          <span
            className={cn(
              'flex shrink-0 items-center justify-center transition-transform duration-200',
              isExpanded && 'rotate-90',
            )}
          >
            <Icon name="chevron-right" size="xs" />
          </span>
          <span className="text-xs font-medium text-(--cui-color-text-muted)">
            {localize(labelKey)}
          </span>
        </button>
      </div>
      {renderCollapsible(
        isExpanded,
        hasEverExpanded,
        <div className="flex flex-col gap-4 pt-2 pl-3">{children}</div>,
      )}
    </section>
  );
}

function FieldGroup({
  labelKey,
  fields,
  parentValue,
  parentPath,
  onChange,
  disabled,
  defaultExpanded,
  transportType,
  lockedKeys,
}: {
  labelKey: string;
  fields: t.SchemaField[];
  parentValue: t.ConfigValue;
  parentPath: string;
  onChange: (path: string, value: t.ConfigValue) => void;
  disabled?: boolean;
  defaultExpanded: boolean;
  transportType: string;
  lockedKeys?: Set<string>;
}) {
  const localize = useLocalize();
  const { isExpanded, hasEverExpanded, sectionRef, toggle } = useCollapsibleSection({
    defaultExpanded,
  });

  if (fields.length === 0) return null;

  return (
    <section ref={sectionRef} className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-(--cui-color-stroke-default) pb-2">
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={toggle}
          className="flex cursor-pointer items-center gap-2 border-none bg-transparent px-0 select-none"
        >
          <span
            className={cn(
              'flex shrink-0 items-center justify-center transition-transform duration-200',
              isExpanded && 'rotate-90',
            )}
          >
            <Icon name="chevron-right" size="xs" />
          </span>
          <span className="text-xs font-medium text-(--cui-color-text-muted)">
            {localize(labelKey)}
          </span>
        </button>
      </div>
      {renderCollapsible(
        isExpanded,
        hasEverExpanded,
        <div className="flex flex-col gap-3 pt-1">
          {flattenGroupFields(
            fields,
            parentValue,
            parentPath,
            onChange,
            localize,
            transportType,
            disabled,
            undefined,
            lockedKeys,
          )}
        </div>,
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// McpEntryFields — dynamic visibility based on transport type
// ---------------------------------------------------------------------------

function McpEntryFields({
  fields,
  parentValue,
  parentPath,
  onChange,
  disabled,
  lockedKeys,
}: {
  fields: t.SchemaField[];
  parentValue: t.ConfigValue;
  parentPath: string;
  onChange: (path: string, value: t.ConfigValue) => void;
  disabled?: boolean;
  lockedKeys?: Set<string>;
}) {
  const localize = useLocalize();
  const values = isPlainObject(parentValue) ? parentValue : {};
  const explicitType = typeof values.type === 'string' ? values.type : '';
  const currentType = explicitType || inferTransportType(values);

  // Build visible field keys based on current transport type
  const currentTransportFields = new Set(TRANSPORT_FIELDS[currentType] ?? []);
  const isRemote = REMOTE_TRANSPORTS.has(currentType);
  const visibleKeys = new Set<string>();
  for (const field of fields) {
    if (INSPECTOR_DERIVED.has(field.key)) continue;
    if (ALL_TRANSPORT_KEYS.has(field.key)) {
      if (currentTransportFields.has(field.key)) {
        visibleKeys.add(field.key);
      }
    } else if (REMOTE_ONLY_FIELDS.has(field.key)) {
      if (isRemote) {
        visibleKeys.add(field.key);
      }
    } else {
      visibleKeys.add(field.key);
    }
  }

  const fieldsByKey = new Map(fields.map((f) => [f.key, f]));
  const collectGroupKeys = (groups: FieldGroupDef[]): string[] =>
    groups.flatMap((g) => [...g.fields, ...(g.children ? collectGroupKeys(g.children) : [])]);
  const allGroupedKeys = new Set(collectGroupKeys(MCP_FIELD_GROUPS));
  const ungrouped = fields.filter((f) => !allGroupedKeys.has(f.key) && visibleKeys.has(f.key));

  const resolveFields = (keys: string[]) =>
    keys
      .map((key) => fieldsByKey.get(key))
      .filter((f): f is t.SchemaField => f != null && visibleKeys.has(f.key));

  const renderGroup = (group: FieldGroupDef) => {
    const hasChildren = group.children && group.children.length > 0;
    const groupFields = resolveFields(group.fields);

    if (hasChildren) {
      const childGroups = group.children!.filter((child) => resolveFields(child.fields).length > 0);
      if (childGroups.length === 0 && groupFields.length === 0) return null;
      return (
        <FieldGroupSection
          key={group.labelKey}
          labelKey={group.labelKey}
          defaultExpanded={group.defaultExpanded}
        >
          {groupFields.length > 0 && (
            <div className="flex flex-col gap-3">
              {flattenGroupFields(
                groupFields,
                parentValue,
                parentPath,
                onChange,
                localize,
                currentType,
                disabled,
                undefined,
                lockedKeys,
              )}
            </div>
          )}
          {childGroups.map((child) => (
            <FieldGroup
              key={child.labelKey}
              labelKey={child.labelKey}
              fields={resolveFields(child.fields)}
              parentValue={parentValue}
              parentPath={parentPath}
              onChange={onChange}
              disabled={disabled}
              defaultExpanded={child.defaultExpanded}
              transportType={currentType}
              lockedKeys={lockedKeys}
            />
          ))}
        </FieldGroupSection>
      );
    }

    return (
      <FieldGroup
        key={group.labelKey}
        labelKey={group.labelKey}
        fields={groupFields}
        parentValue={parentValue}
        parentPath={parentPath}
        onChange={onChange}
        disabled={disabled}
        defaultExpanded={group.defaultExpanded}
        transportType={currentType}
        lockedKeys={lockedKeys}
      />
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {MCP_FIELD_GROUPS.map(renderGroup)}
      {ungrouped.length > 0 && (
        <FieldGroup
          labelKey="com_config_group_advanced"
          fields={ungrouped}
          parentValue={parentValue}
          parentPath={parentPath}
          onChange={onChange}
          disabled={disabled}
          defaultExpanded={false}
          transportType={currentType}
          lockedKeys={lockedKeys}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CreateMcpServerDialog
// ---------------------------------------------------------------------------

function CreateMcpServerDialog({
  open,
  onClose,
  onSave,
  fields,
  existingKeys,
  renderFields,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (serverName: string, entry: Record<string, t.ConfigValue>) => void;
  fields: t.SchemaField[];
  existingKeys: Set<string>;
  renderFields: t.CollectionRenderFields;
}) {
  const localize = useLocalize();
  const [serverName, setServerName] = useState('');
  const [draft, setDraft] = useState<Record<string, t.ConfigValue>>({});
  const [error, setError] = useState<string | undefined>();

  const handleFieldChange = useCallback((key: string, value: t.ConfigValue) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setError(undefined);
  }, []);

  const handleSubmit = useCallback(() => {
    const name = serverName.trim();
    if (!name) {
      setError(localize('com_config_server_name_required'));
      return;
    }
    if (name.includes('.')) {
      setError(localize('com_config_server_name_no_dots'));
      return;
    }
    if (name === '__proto__' || name === 'constructor' || name === 'prototype') {
      setError(localize('com_config_server_name_invalid'));
      return;
    }
    if (existingKeys.has(name)) {
      setError(localize('com_config_server_name_exists'));
      return;
    }
    const entry: Record<string, t.ConfigValue> = {};
    for (const [key, val] of Object.entries(draft)) {
      if (val === '' || val === undefined || val === null) continue;
      if (Array.isArray(val) && val.length === 0) continue;
      entry[key] = val;
    }
    onSave(name, entry);
    setServerName('');
    setDraft({});
    setError(undefined);
    onClose();
  }, [serverName, draft, existingKeys, localize, onSave, onClose]);

  const handleClose = useCallback(() => {
    setServerName('');
    setDraft({});
    setError(undefined);
    onClose();
  }, [onClose]);

  return (
    <FormDialog
      open={open}
      title={localize('com_config_create_mcp_server')}
      submitLabel={localize('com_ui_create')}
      submitDisabled={!serverName.trim() || !(draft.type || inferTransportType(draft))}
      saving={false}
      error={error}
      size="lg"
      onSubmit={handleSubmit}
      onClose={handleClose}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="mcp-server-name"
            className="text-sm font-medium text-(--cui-color-text-default)"
          >
            {localize('com_config_server_name')} <span className="text-red-500">*</span>
          </label>
          <input
            id="mcp-server-name"
            type="text"
            value={serverName}
            onChange={(e) => {
              setServerName(e.target.value);
              setError(undefined);
            }}
            placeholder={localize('com_config_server_name')}
            className="config-input px-2.5 py-1.5 text-sm"
            autoFocus
          />
        </div>
        {renderFields(fields, draft, 'create-mcp-server', handleFieldChange)}
      </div>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------
// McpServersRenderer — main export
// ---------------------------------------------------------------------------

export function McpServersRenderer(props: t.FieldRendererProps) {
  const {
    fields,
    parentPath,
    parentValue,
    getValue,
    onChange,
    disabled,
    editedValues,
    yamlBaseKeys,
    onValidationError,
  } = props;
  const localize = useLocalize();
  const [createOpen, setCreateOpen] = useState(false);
  const [justAddedKey, setJustAddedKey] = useState<string | null>(null);

  const path = parentPath;
  const entryPrefix = `${path}.`;
  const baseValue = getValue(path, parentValue ?? {});
  const baseRecord: Record<string, t.ConfigValue> = isPlainObject(baseValue) ? baseValue : {};

  /**
   * Group edited paths by their entry key. Per-leaf paths are
   * `mcpServers.<key>.<...>`; the entry key is the first path segment after
   * the renderer's parent path. We collect [segmentsAfterEntry, value] pairs
   * keyed by entry name so the record overlay can apply edits per entry
   * without re-walking the full edit map.
   */
  const editsByEntry = useMemo(() => {
    const map = new Map<string, Array<{ segments: string[]; value: t.ConfigValue }>>();
    if (!editedValues) return map;
    for (const [editPath, value] of Object.entries(editedValues)) {
      if (!editPath.startsWith(entryPrefix)) continue;
      const rest = editPath.slice(entryPrefix.length);
      const parts = rest.split('.');
      const entryKey = parts[0];
      if (!entryKey) continue;
      const segments = parts.slice(1);
      const list = map.get(entryKey) ?? [];
      list.push({ segments, value });
      map.set(entryKey, list);
    }
    return map;
  }, [editedValues, entryPrefix]);

  /**
   * Effective record overlay: walks every per-leaf edit for each entry and
   * applies it on top of the base value. Leaf undefined deletes the leaf;
   * if every leaf under an entry is undefined and the entry has no remaining
   * keys, the entry is removed from the rendered list. Entries with no edits
   * are referenced by identity from `baseRecord` (no deep clone) so steady
   * state does not pay for cloning unchanged data.
   */
  const record = useMemo(() => {
    if (editsByEntry.size === 0) return baseRecord;
    const result: Record<string, t.ConfigValue> = {};
    for (const [k, v] of Object.entries(baseRecord)) {
      if (!editsByEntry.has(k)) {
        result[k] = v;
      }
    }
    for (const [entryKey, leafEdits] of editsByEntry) {
      // Whole-entry writes (empty segments) are kept for backward compatibility
      // with the previous create/delete flows.
      const wholeEntryWrites = leafEdits.filter((e) => e.segments.length === 0);
      const leafWrites = leafEdits.filter((e) => e.segments.length > 0);

      let current: t.ConfigValue | undefined;
      if (wholeEntryWrites.length > 0) {
        const last = wholeEntryWrites[wholeEntryWrites.length - 1];
        if (last.value === undefined) {
          continue;
        }
        current = last.value;
      } else if (entryKey in baseRecord) {
        current = baseRecord[entryKey];
      }

      if (leafWrites.length === 0) {
        if (current !== undefined) result[entryKey] = current;
        continue;
      }
      const existingObj = isPlainObject(current) ? current : {};
      const overlay = applyLeafOverlay(
        existingObj,
        leafWrites.map((e) => [e.segments, e.value] as [string[], t.ConfigValue]),
      );
      result[entryKey] = overlay;
    }
    return result;
  }, [baseRecord, editsByEntry]);

  const entries = useMemo(() => Object.entries(record), [record]);

  const existingKeys = useMemo(() => new Set(Object.keys(record)), [record]);

  /**
   * Server identity is locked iff the entry's name appears in the un-merged
   * YAML/file base config (sourced via getBaseConfigFn's yamlMcpKeys).
   *
   * When the upstream YAML key set is unavailable (older LibreChat backend
   * without ?baseOnly=true support), return an empty set so nothing is
   * locked. That degrades to "everything editable" rather than to a
   * subtraction heuristic which produced false positives on YAML servers
   * with admin overrides on cosmetic fields like title or iconPath.
   */
  const yamlSourceKeys = useMemo(() => {
    return yamlBaseKeys ?? new Set<string>();
  }, [yamlBaseKeys]);

  /**
   * Refs let the create/remove/rename callbacks stay referentially stable so
   * memo(McpEntryRow) actually bails on entries that didn't change. The refs
   * shadow editedValues/baseRecord/record (each of which changes on every
   * keystroke) and are read at call time from inside the callback bodies.
   */
  const editedValuesRef = useRef(editedValues);
  useEffect(() => {
    editedValuesRef.current = editedValues;
  }, [editedValues]);

  const baseRecordRef = useRef(baseRecord);
  useEffect(() => {
    baseRecordRef.current = baseRecord;
  }, [baseRecord]);

  const recordRef = useRef(record);
  useEffect(() => {
    recordRef.current = record;
  }, [record]);

  const handleCreate = useCallback(
    (serverName: string, entry: Record<string, t.ConfigValue>) => {
      if (serverName.includes('.')) {
        onValidationError?.(localize('com_config_server_name_no_dots'));
        return;
      }
      if (
        serverName === '__proto__' ||
        serverName === 'constructor' ||
        serverName === 'prototype'
      ) {
        onValidationError?.(localize('com_config_server_name_invalid'));
        return;
      }
      for (const [fieldKey, fieldValue] of Object.entries(entry)) {
        if (fieldValue === undefined || fieldValue === null) continue;
        if (fieldValue === '') continue;
        if (Array.isArray(fieldValue) && fieldValue.length === 0) continue;
        if (isPlainObject(fieldValue)) {
          for (const { segments, value } of enumerateLeafPaths(fieldValue, [fieldKey])) {
            if (value === undefined || value === null || value === '') continue;
            if (Array.isArray(value) && value.length === 0) continue;
            onChange(`${path}.${serverName}.${segments.join('.')}`, value);
          }
        } else {
          onChange(`${path}.${serverName}.${fieldKey}`, fieldValue);
        }
      }
      setJustAddedKey(serverName);
    },
    [onChange, path, localize, onValidationError],
  );

  const handleRemove = useCallback(
    (key: string) => {
      const editedValues = editedValuesRef.current;
      const baseRecord = baseRecordRef.current;
      const prefix = `${path}.${key}.`;
      const entryPath = `${path}.${key}`;
      const seen = new Set<string>();
      if (editedValues) {
        for (const editPath of Object.keys(editedValues)) {
          if (editPath.startsWith(prefix) || editPath === entryPath) {
            onChange(editPath, undefined);
            seen.add(editPath);
          }
        }
      }
      const baseEntry = baseRecord[key];
      if (isPlainObject(baseEntry)) {
        for (const { segments } of enumerateLeafPaths(baseEntry)) {
          const leafPath = `${prefix}${segments.join('.')}`;
          if (!seen.has(leafPath)) onChange(leafPath, undefined);
        }
      }
      /**
       * Also emit a delete at the entry path so MongoDB's $unset collapses
       * the whole subtree. Per-leaf $unset alone leaves an empty parent
       * object that refetches as a phantom server entry.
       */
      if (!seen.has(entryPath)) {
        onChange(entryPath, undefined);
      }
    },
    [onChange, path],
  );

  const handleRename = useCallback(
    (oldKey: string, newKey: string) => {
      if (newKey === oldKey) {
        return;
      }
      const editedValues = editedValuesRef.current;
      const baseRecord = baseRecordRef.current;
      const record = recordRef.current;
      if (newKey.includes('.')) {
        onValidationError?.(localize('com_config_server_name_no_dots'));
        return;
      }
      if (newKey === '__proto__' || newKey === 'constructor' || newKey === 'prototype') {
        onValidationError?.(localize('com_config_server_name_invalid'));
        return;
      }
      if (Object.hasOwn(record, newKey)) {
        onValidationError?.(localize('com_config_server_name_exists'));
        return;
      }
      const oldPrefixFull = `${path}.${oldKey}`;
      if (editedValues) {
        for (const editPath of Object.keys(editedValues)) {
          if (editPath === oldPrefixFull || editPath.startsWith(`${oldPrefixFull}.`)) {
            onChange(editPath, undefined);
          }
        }
      }
      const oldPrefix = `${path}.${oldKey}.`;
      const newPrefix = `${path}.${newKey}.`;
      const baseEntry = baseRecord[oldKey];
      const overlayEntry = record[oldKey];

      /**
       * Enumerate leaves recursively so nested per-leaf data like
       * `headers.Authorization` survives the rename intact. The overlay
       * representation is authoritative because the edit overlay already
       * reflects in-flight changes (including deletions); we still walk the
       * base to find leaves removed only in the overlay so the old paths get
       * proper undefined-cleanup writes.
       */
      const baseLeaves = isPlainObject(baseEntry) ? enumerateLeafPaths(baseEntry) : [];
      const overlayLeaves = isPlainObject(overlayEntry) ? enumerateLeafPaths(overlayEntry) : [];

      const overlayBySeg = new Map<string, t.ConfigValue>();
      for (const { segments, value } of overlayLeaves) {
        overlayBySeg.set(segments.join('.'), value);
      }
      const allSegKeys = new Set<string>([
        ...overlayBySeg.keys(),
        ...baseLeaves.map((l) => l.segments.join('.')),
      ]);

      for (const segKey of allSegKeys) {
        const segments = segKey.split('.');
        const leafValue = overlayBySeg.get(segKey);
        if (leafValue !== undefined) {
          onChange(`${newPrefix}${segments.join('.')}`, leafValue);
        }
        onChange(`${oldPrefix}${segments.join('.')}`, undefined);
      }
      /**
       * Emit an entry-path delete on the old key so MongoDB's $unset collapses
       * the whole subtree. Without this, per-leaf unsets leave an empty parent
       * object that refetches as a phantom entry under the old name.
       */
      onChange(`${path}.${oldKey}`, undefined);
    },
    [onChange, path, localize, onValidationError],
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 py-2">
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          disabled={disabled}
          className="config-add-btn"
        >
          <Icon name="plus" size="sm" />
          <span>{localize('com_config_create_mcp_server')}</span>
        </button>
      </div>
      {entries.map(([key, entryValue]) => (
        <McpEntryRow
          key={key}
          entryKey={key}
          entryValue={entryValue}
          fields={fields}
          path={path}
          disabled={disabled}
          isYamlSource={yamlSourceKeys.has(key)}
          onChange={onChange}
          onRemove={handleRemove}
          onRename={handleRename}
          justAddedKey={justAddedKey}
        />
      ))}
      {entries.length === 0 && (
        <p className="py-2 text-sm text-(--cui-color-text-muted)">
          {localize('com_config_no_entries')}
        </p>
      )}
      <CreateMcpServerDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSave={handleCreate}
        fields={fields}
        existingKeys={existingKeys}
        renderFields={(entryFields, ev, ep, eoc) => (
          <McpEntryFields
            fields={entryFields}
            parentValue={ev}
            parentPath={ep}
            onChange={eoc}
            disabled={disabled}
          />
        )}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// McpEntryRow — single entry card, memoized per entry
// ---------------------------------------------------------------------------

const McpEntryRow = memo(function McpEntryRowImpl({
  entryKey,
  entryValue,
  fields,
  path,
  disabled,
  isYamlSource,
  onChange,
  onRemove,
  onRename,
  justAddedKey,
}: {
  entryKey: string;
  entryValue: t.ConfigValue;
  fields: t.SchemaField[];
  path: string;
  disabled?: boolean;
  isYamlSource: boolean;
  onChange: (path: string, value: t.ConfigValue) => void;
  onRemove: (key: string) => void;
  onRename: (oldKey: string, newKey: string) => void;
  justAddedKey: string | null;
}) {
  const entryObj = isPlainObject(entryValue) ? entryValue : {};
  const rawType = typeof entryObj.type === 'string' ? entryObj.type : '';
  const inferred = rawType || inferTransportType(entryObj);
  const effectiveType = inferred === 'http' ? 'streamable-http' : inferred;
  const displayValue =
    effectiveType !== rawType ? { ...entryObj, type: effectiveType } : entryValue;

  const entryPathBase = `${path}.${entryKey}`;
  const lockedKeys = isYamlSource ? YAML_LOCKED_FIELDS : undefined;

  /**
   * Stable per-leaf onChange shared across renderFields invocations. Hoisting
   * this out of the renderEntryFields closure keeps child component identity
   * steady when the parent re-renders with the same props.
   */
  const entryOnChange = useCallback(
    (leafKey: string, leafValue: t.ConfigValue) => {
      onChange(`${entryPathBase}.${leafKey}`, leafValue);
    },
    [onChange, entryPathBase],
  );

  /**
   * Bypass ObjectEntryCard.handleFieldChange and write absolute per-leaf paths
   * directly. The renderFields callback ignores the handleFieldChange supplied
   * by ObjectEntryCard and uses an entry-scoped onChange built here that
   * prefixes with the full entry path.
   */
  const renderEntryFields: t.CollectionRenderFields = useCallback(
    (entryFields, ev, ep) => (
      <McpEntryFields
        fields={entryFields}
        parentValue={ev}
        parentPath={ep}
        onChange={entryOnChange}
        disabled={disabled}
        lockedKeys={lockedKeys}
      />
    ),
    [entryOnChange, disabled, lockedKeys],
  );

  /** Whole-entry replace path (kept for back-compat with ObjectEntryCard's
   *  onValueChange contract). Not used by typical leaf edits. */
  const handleWholeEntryChange = useCallback(
    (v: t.ConfigValue) => {
      onChange(entryPathBase, v);
    },
    [onChange, entryPathBase],
  );

  return (
    <ObjectEntryCard
      id={`section-mcpServers-${encodeURIComponent(entryKey)}`}
      entryKey={entryKey}
      fields={fields}
      value={displayValue}
      onValueChange={handleWholeEntryChange}
      onRemove={disabled || isYamlSource ? undefined : () => onRemove(entryKey)}
      onRename={disabled || isYamlSource ? undefined : (renamed) => onRename(entryKey, renamed)}
      disabled={disabled}
      defaultExpanded={entryKey === justAddedKey}
      renderFields={renderEntryFields}
    />
  );
});

// Re-export metadata constants used by tests / future schema-driven extraction.
export {
  YAML_LOCKED_FIELDS,
  INSPECTOR_DERIVED,
  REQUIRED_BY_TRANSPORT,
  inferTransportType,
  enumerateLeafPaths,
};
