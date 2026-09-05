import { z } from 'zod';
import yaml from 'js-yaml';
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { configSchema } from 'librechat-data-provider';
import { SystemCapabilities } from '@librechat/data-schemas/capabilities';
import type * as t from '@/types';
import {
  filterSecretPreviewFields,
  mergeUntouchedSecrets,
  retainSnapshotSecretsOnly,
  stripSecretPreviewValues,
  collectSecretFieldPaths,
  PREVIOUS_IDENTITY_HINT_KEY,
} from '@/utils';
import {
  filterInterfacePermissionChildren,
  isInterfacePermissionPath,
  stripInterfacePermissionFields,
} from '@/utils/interfacePermissions';
import { requireCapability, requireAllSectionCapabilities } from './capabilities';
import { canonicalizeResetPaths, getValueAtPath } from './utils/configPaths';
import { readAuthenticatedBaseConfigSnapshot } from './revisions';
import { ConfigVersionConflictError } from './utils/errors';
import { BASE_CONFIG_PRINCIPAL_ID } from './constants';
import { safeFieldPath } from './utils/validation';
import { flattenObject } from '@/utils/format';
import { apiFetch } from './utils/api';

/**
 * Forward-compat shim: the pinned `librechat-data-provider@^0.8.509` predates the
 * `langfuse` config group. Inject the section node so the custom renderer remains
 * discoverable until a data-provider release containing the group is pinned. The
 * renderer persists through LibreChat's dedicated Langfuse connection API.
 */
const LANGFUSE_SHIM_FIELD: t.SchemaField = {
  path: 'langfuse',
  key: 'langfuse',
  type: 'object',
  isOptional: true,
  isNullable: false,
  isArray: false,
  isObject: true,
  depth: 0,
  children: (['enabled', 'destination', 'publicKey', 'secretKey', 'displaySecretKey'] as const).map(
    (key) => ({
      path: `langfuse.${key}`,
      key,
      type: key === 'enabled' ? 'boolean' : 'string',
      isOptional: true,
      isNullable: false,
      isArray: false,
      isObject: false,
      depth: 1,
    }),
  ),
};

export function applyLangfuseSchemaVisibility(
  tree: t.SchemaField[],
  fanoutEnabled: boolean | undefined,
): t.SchemaField[] {
  const langfuseIndex = tree.findIndex((section) => section.key === 'langfuse');
  if (fanoutEnabled === false) {
    if (langfuseIndex >= 0) {
      tree.splice(langfuseIndex, 1);
    }
    return tree;
  }
  if (fanoutEnabled === true && langfuseIndex < 0) {
    tree.push(LANGFUSE_SHIM_FIELD);
  }
  return tree;
}

const WRAPPER_TYPES = new Set([
  'ZodOptional',
  'ZodDefault',
  'ZodNullable',
  'ZodEffects',
  'ZodLazy',
  'ZodPipeline',
]);

const ARRAY_INDEX_KEY_RE = /^(0|[1-9]\d*)$/;
const MAX_PATCH_MUTATIONS = 100;
/** Hard cap for indexed array edits; additions use whole-array writes instead. */
const MAX_INDEXED_ARRAY_INDEX = 10_000;

function unwrapSchema(schema: t.ZodSchemaLike): t.ZodSchemaLike {
  const seen = new Set<t.ZodSchemaLike>();
  let current = schema;
  while (current?._def?.typeName && WRAPPER_TYPES.has(current._def.typeName)) {
    if (seen.has(current)) break;
    seen.add(current);
    let next: t.ZodSchemaLike | undefined;
    if (current._def.typeName === 'ZodLazy') {
      next = current._def.getter?.();
    } else if (current._def.typeName === 'ZodPipeline') {
      next = current._def.out;
    } else if (current._def.typeName === 'ZodEffects') {
      next = current._def.schema;
    } else {
      next = current._def.innerType;
    }
    if (!next) break;
    current = next;
  }
  return current;
}

/** Merges the object shapes from both sides of a ZodIntersection. Non-object
 *  sides (e.g. arrays) are intentionally dropped — only object shapes are
 *  extractable for the schema-driven form renderer. */
function resolveIntersection(schema: t.ZodSchemaLike): t.ZodSchemaLike | null {
  if (schema?._def?.typeName !== 'ZodIntersection') return null;
  const left = unwrapSchema(schema._def.left ?? ({} as t.ZodSchemaLike));
  const right = unwrapSchema(schema._def.right ?? ({} as t.ZodSchemaLike));
  const leftShape = left && typeof left === 'object' && 'shape' in left ? left.shape : undefined;
  const rightShape =
    right && typeof right === 'object' && 'shape' in right ? right.shape : undefined;
  if (!leftShape && !rightShape) return null;
  return { shape: { ...leftShape, ...rightShape } };
}

/** Detects union(boolean | object{...}) — a feature toggle pattern where
 *  `false` disables and an object gives fine-grained control.
 *  Handles boolean variants wrapped in ZodOptional/ZodDefault. */
function hasBooleanObjectUnion(schema: t.ZodSchemaLike): boolean {
  if (!schema?._def || schema._def.typeName !== 'ZodUnion') return false;
  const options = schema._def.options || [];
  if (options.length < 2) return false;
  let hasBool = false;
  let hasObj = false;
  for (const opt of options) {
    const unwrapped = unwrapSchema(opt);
    if (!hasBool && unwrapped?._def?.typeName === 'ZodBoolean') hasBool = true;
    if (!hasObj && unwrapped && typeof unwrapped === 'object' && 'shape' in unwrapped)
      hasObj = true;
    if (hasBool && hasObj) return true;
  }
  return false;
}

function isUnionOfObjects(schema: t.ZodSchemaLike): boolean {
  if (!schema?._def || schema._def.typeName !== 'ZodUnion') return false;
  const options = schema._def.options || [];
  return (
    options.length > 0 &&
    options.every((opt: t.ZodSchemaLike) => opt && typeof opt === 'object' && 'shape' in opt)
  );
}

function hasUnionObjectVariant(schema: t.ZodSchemaLike): boolean {
  if (!schema?._def || schema._def.typeName !== 'ZodUnion') return false;
  const options = schema._def.options || [];
  return options.some((opt: t.ZodSchemaLike) => opt && typeof opt === 'object' && 'shape' in opt);
}

const ZOD_TO_KV: Record<string, t.KVValueType> = {
  ZodString: 'string',
  ZodNumber: 'number',
  ZodBoolean: 'boolean',
};

function inferRecordKVTypes(schema: t.ZodSchemaLike): t.KVValueType[] | undefined {
  if (!schema?._def) return undefined;
  const tn = schema._def.typeName;
  if (tn && tn in ZOD_TO_KV) return [ZOD_TO_KV[tn]];
  if (tn !== 'ZodUnion') return undefined;
  const types = new Set<t.KVValueType>();
  for (const opt of schema._def.options ?? []) {
    const optTn = opt?._def?.typeName;
    if (optTn && optTn in ZOD_TO_KV) {
      types.add(ZOD_TO_KV[optTn]);
    } else if (
      optTn === 'ZodRecord' ||
      optTn === 'ZodArray' ||
      optTn === 'ZodObject' ||
      (opt && typeof opt === 'object' && 'shape' in opt)
    ) {
      types.add('json');
    }
  }
  return types.size > 0 ? [...types] : undefined;
}

/** Merges fields from union object variants into a single list.
 *  When the same key appears in multiple variants with different literal
 *  types, the literals are combined into a union(literal(...) | literal(...))
 *  so discriminator fields like `type` render as selects. */
function mergeVariantFields(
  schema: t.ZodSchemaLike,
  parentPath: string[],
  depth: number,
  objectsOnly: boolean,
): t.SchemaField[] {
  const options = schema._def?.options ?? [];
  const byKey = new Map<string, t.SchemaField>();

  for (const opt of options) {
    if (objectsOnly && !(opt && typeof opt === 'object' && 'shape' in opt)) continue;
    for (const field of extractSchemaTree(opt, parentPath, depth)) {
      const existing = byKey.get(field.key);
      if (!existing) {
        byKey.set(field.key, { ...field, isOptional: true });
      } else if (
        existing.type !== field.type &&
        isLiteralLike(existing.type) &&
        isLiteralLike(field.type)
      ) {
        existing.type = mergeLiteralTypes(existing.type, field.type);
      }
    }
  }
  return [...byKey.values()];
}

function isLiteralLike(type: string): boolean {
  if (type.startsWith('literal(')) return true;
  if (type.startsWith('union(') && type.includes('literal(')) return true;
  return false;
}

function extractLiterals(type: string): string[] {
  if (type.startsWith('literal(')) return [type];
  if (type.startsWith('union(')) {
    const inner = type.slice(6, -1);
    return inner.split(' | ').filter((s) => s.startsWith('literal('));
  }
  return [];
}

function mergeLiteralTypes(a: string, b: string): string {
  const existing = extractLiterals(a);
  for (const lit of extractLiterals(b)) {
    if (!existing.includes(lit)) existing.push(lit);
  }
  return existing.length === 1 ? existing[0] : `union(${existing.join(' | ')})`;
}

function extractUnionObjectVariants(
  schema: t.ZodSchemaLike,
  parentPath: string[],
  depth: number,
): t.SchemaField[] {
  return mergeVariantFields(schema, parentPath, depth, true);
}

function mergeUnionVariantFields(
  schema: t.ZodSchemaLike,
  parentPath: string[],
  depth: number,
): t.SchemaField[] {
  return mergeVariantFields(schema, parentPath, depth, false);
}

export function extractSchemaTree(
  schema: t.ZodSchemaLike,
  path: string[] = [],
  depth: number = 0,
): t.SchemaField[] {
  const fields: t.SchemaField[] = [];

  if (schema && typeof schema === 'object' && 'shape' in schema) {
    const shape = schema.shape;
    if (shape && typeof shape === 'object') {
      for (const [key, value] of Object.entries(shape)) {
        const currentPath = [...path, key];
        const fieldPath = currentPath.join('.');

        let isOptional = false;
        let isNullable = false;
        let innerSchema: t.ZodSchemaLike = value;
        let description: string | undefined;

        while (innerSchema?._def?.typeName && WRAPPER_TYPES.has(innerSchema._def.typeName)) {
          const def = innerSchema._def;
          if (def.description && !description) {
            description = def.description;
          }
          if (def.typeName === 'ZodOptional' || def.typeName === 'ZodDefault') {
            isOptional = true;
          }
          if (def.typeName === 'ZodNullable') {
            isNullable = true;
          }
          let next: t.ZodSchemaLike | undefined;
          if (def.typeName === 'ZodLazy') {
            next = def.getter?.();
          } else if (def.typeName === 'ZodPipeline') {
            next = def.out;
          } else if (def.typeName === 'ZodEffects') {
            next = def.schema;
          } else {
            next = def.innerType;
          }
          if (!next) break;
          innerSchema = next;
        }

        if (innerSchema?._def?.description && !description) {
          description = innerSchema._def.description;
        }

        const resolved = resolveIntersection(innerSchema);
        if (resolved) innerSchema = resolved;

        if (innerSchema && typeof innerSchema === 'object' && 'shape' in innerSchema) {
          const children = extractSchemaTree(innerSchema, currentPath, depth + 1);
          fields.push({
            path: fieldPath,
            key,
            type: 'object',
            isOptional,
            isNullable,
            isArray: false,
            isObject: true,
            description,
            children,
            depth,
          });
        } else if (isUnionOfObjects(innerSchema)) {
          const children = mergeUnionVariantFields(innerSchema, currentPath, depth + 1);
          fields.push({
            path: fieldPath,
            key,
            type: 'object',
            isOptional,
            isNullable,
            isArray: false,
            isObject: true,
            description,
            children,
            depth,
          });
        } else if (hasBooleanObjectUnion(innerSchema)) {
          const children = extractUnionObjectVariants(innerSchema, currentPath, depth + 1);
          fields.push({
            path: fieldPath,
            key,
            type: getZodTypeName(innerSchema),
            isOptional,
            isNullable,
            isArray: false,
            isObject: false,
            description,
            children,
            depth,
          });
        } else {
          const typeName = getZodTypeName(innerSchema);
          const isArray = checkIsArray(innerSchema);
          const isObject = checkIsObject(innerSchema);

          let children: t.SchemaField[] | undefined;
          let recordValueType: 'primitive' | 'complex' | undefined;
          let recordValueAllowsPrimitive: boolean | undefined;
          let recordValueKVTypes: t.KVValueType[] | undefined;

          if (isArray && innerSchema?._def?.type) {
            let elementSchema: t.ZodSchemaLike = innerSchema._def.type;
            const resolvedElement = resolveIntersection(elementSchema);
            if (resolvedElement) elementSchema = resolvedElement;
            if (elementSchema && typeof elementSchema === 'object' && 'shape' in elementSchema) {
              children = extractSchemaTree(elementSchema, [...currentPath, '[]'], depth + 1);
            } else if (isUnionOfObjects(elementSchema)) {
              children = mergeUnionVariantFields(elementSchema, [...currentPath, '[]'], depth + 1);
            }
          }

          if (typeName === 'record' && innerSchema?._def) {
            const valueSchema = (innerSchema._def as t.ZodDef & { valueType?: t.ZodSchemaLike })
              .valueType;
            if (valueSchema) {
              const unwrapped = unwrapSchema(valueSchema);
              if (unwrapped && typeof unwrapped === 'object' && 'shape' in unwrapped) {
                children = extractSchemaTree(unwrapped, [...currentPath, '{}'], depth + 1);
                recordValueType = 'complex';
              } else if (isUnionOfObjects(unwrapped)) {
                children = mergeUnionVariantFields(unwrapped, [...currentPath, '{}'], depth + 1);
                recordValueType = 'complex';
              } else if (hasUnionObjectVariant(unwrapped)) {
                children = extractUnionObjectVariants(unwrapped, [...currentPath, '{}'], depth + 1);
                recordValueType = 'complex';
                recordValueAllowsPrimitive = true;
              } else {
                recordValueType = 'primitive';
                recordValueKVTypes = inferRecordKVTypes(unwrapped);
              }
            }
          }

          fields.push({
            path: fieldPath,
            key,
            type: typeName,
            isOptional,
            isNullable,
            isArray,
            isObject,
            children,
            description,
            depth,
            recordValueType,
            recordValueAllowsPrimitive,
            recordValueKVTypes,
          });
        }
      }
    }
  }

  return filterSecretPreviewFields(fields);
}

export function flattenTree(fields: t.SchemaField[]): t.SchemaField[] {
  const result: t.SchemaField[] = [];
  for (const field of fields) {
    result.push(field);
    if (field.children) {
      result.push(...flattenTree(field.children));
    }
  }
  return result;
}

function checkIsArray(schema: t.ZodSchemaLike): boolean {
  if (!schema || typeof schema !== 'object') return false;
  if ('_def' in schema) {
    return schema._def?.typeName === 'ZodArray';
  }
  return false;
}

function checkIsObject(schema: t.ZodSchemaLike): boolean {
  if (!schema || typeof schema !== 'object') return false;
  return 'shape' in schema;
}

const MAX_ZOD_TYPE_DEPTH = 10;

export function getZodTypeName(
  schema: t.ZodSchemaLike,
  _seen?: Set<t.ZodSchemaLike>,
  _depth?: number,
): string {
  if (!schema || typeof schema !== 'object') return 'unknown';

  const depth = _depth ?? 0;
  if (depth >= MAX_ZOD_TYPE_DEPTH) return 'unknown';

  const seen = _seen ?? new Set<t.ZodSchemaLike>();
  if (seen.has(schema)) return 'unknown';
  seen.add(schema);

  const innerSchema = unwrapSchema(schema);

  if (!innerSchema || typeof innerSchema !== 'object' || !innerSchema._def) {
    return 'unknown';
  }

  if (innerSchema !== schema) {
    if (seen.has(innerSchema)) return 'unknown';
    seen.add(innerSchema);
  }

  const typeName = innerSchema._def.typeName;

  if (typeName === 'ZodString') return 'string';
  if (typeName === 'ZodNumber') return 'number';
  if (typeName === 'ZodBoolean') return 'boolean';
  if (typeName === 'ZodNull') return 'null';
  if (typeName === 'ZodArray') {
    const elementType = innerSchema._def.type;
    if (!elementType) return 'array<unknown>';
    const elementTypeName = getZodTypeName(elementType, seen, depth + 1);
    return `array<${elementTypeName}>`;
  }
  if (typeName === 'ZodObject') return 'object';
  if (typeName === 'ZodEnum') {
    const values = innerSchema._def?.values ?? [];
    return `enum(${Array.isArray(values) ? values.join(' | ') : Object.values(values).join(' | ')})`;
  }
  if (typeName === 'ZodNativeEnum') {
    const raw = innerSchema._def?.values ?? {};
    const numericValues = Object.entries(raw).filter(([, v]) => typeof v === 'number') as Array<
      [string, number]
    >;
    if (numericValues.length > 0) {
      return `enum(${numericValues.map(([label, val]) => `${label}=${val}`).join(' | ')})`;
    }
    const stringValues = Object.values(raw).filter((v): v is string => typeof v === 'string');
    if (stringValues.length > 0) return `enum(${stringValues.join(' | ')})`;
    return 'enum';
  }
  if (typeName === 'ZodUnion') {
    const options = innerSchema._def.options || [];
    const types = options.map((opt: t.ZodSchemaLike) => getZodTypeName(opt, seen, depth + 1));
    return `union(${types.join(' | ')})`;
  }
  if (typeName === 'ZodLiteral') {
    const literalValue = innerSchema._def.value;
    return `literal(${JSON.stringify(literalValue)})`;
  }
  if (typeName === 'ZodRecord') return 'record';
  if (typeName === 'ZodAny') return 'any';
  if (typeName === 'ZodUnknown') return 'unknown';
  return typeName || 'unknown';
}

/** Synthesizes a union without z.union to avoid the zod v3/v4 cross-version pitfall. */
function anyOfSchema(candidates: t.ZodSchemaLike[]): t.ZodSchemaLike {
  type ParseResult = {
    success: boolean;
    error?: { issues: Array<{ message: string; path: (string | number)[] }> };
  };
  const safeParse = (value: unknown): ParseResult => {
    const errors: NonNullable<ParseResult['error']>[] = [];
    for (const candidate of candidates) {
      const c = candidate as t.ZodSchemaLike & {
        safeParse?: (v: unknown) => ParseResult;
      };
      if (typeof c.safeParse !== 'function') continue;
      let result: ParseResult;
      try {
        result = c.safeParse(value);
      } catch (e) {
        errors.push({
          issues: [{ message: e instanceof Error ? e.message : 'Validation failed', path: [] }],
        });
        continue;
      }
      if (result.success) return { success: true };
      if (result.error) errors.push(result.error);
    }
    /** Pick the branch with the fewest issues (most likely the intended one); tiebreak on longest path. */
    const sorted = errors
      .filter((e): e is NonNullable<typeof e> => e != null && Array.isArray(e.issues))
      .sort((a, b) => {
        const ca = a.issues?.length ?? Infinity;
        const cb = b.issues?.length ?? Infinity;
        if (ca !== cb) return ca - cb;
        const pa = Math.max(0, ...(a.issues ?? []).map((i) => i.path?.length ?? 0));
        const pb = Math.max(0, ...(b.issues ?? []).map((i) => i.path?.length ?? 0));
        return pb - pa;
      });
    const best = sorted[0];
    return {
      success: false,
      error: best ?? { issues: [{ message: 'Validation failed', path: [] }] },
    };
  };
  /** _def.options is preserved so resolveSubSchema can keep traversing into nested fields under union branches; without it, the next segment short-circuits and validateFieldValue silently passes everything. */
  return { _def: { typeName: 'ZodUnion', options: candidates }, safeParse } as t.ZodSchemaLike;
}

/** Walks a Zod schema tree to find the sub-schema at a given dot-path.
 *  Returns the schema **with wrappers intact** so `.safeParse()` runs the
 *  full validation chain (refine, transform, pipe). Returns `null` if the
 *  path cannot be resolved. */
export function resolveSubSchema(
  schema: t.ZodSchemaLike,
  segments: string[],
): t.ZodSchemaLike | null {
  let current: t.ZodSchemaLike = schema;

  for (const segment of segments) {
    const unwrapped = unwrapSchema(current);
    if (!unwrapped?._def) return null;

    const typeName = unwrapped._def.typeName;

    if (unwrapped.shape && typeof unwrapped.shape === 'object') {
      const next = unwrapped.shape[segment];
      if (!next) return null;
      current = next;
    } else if (typeName === 'ZodArray') {
      const elementType = unwrapped._def.type;
      if (!elementType) return null;
      current = elementType;
    } else if (typeName === 'ZodRecord') {
      const valueType = (unwrapped._def as t.ZodDef & { valueType?: t.ZodSchemaLike }).valueType;
      if (!valueType) return null;
      current = valueType;
    } else if (typeName === 'ZodUnion') {
      const options = unwrapped._def.options ?? [];
      const candidates: t.ZodSchemaLike[] = [];
      for (const opt of options) {
        /** Recurse so options that are records, arrays, or further unions resolve through their own walker case, not just shape lookup. */
        const resolved = resolveSubSchema(opt, [segment]);
        if (resolved) candidates.push(resolved);
      }
      if (candidates.length === 0) return null;
      if (candidates.length === 1) {
        current = candidates[0];
      } else {
        current = anyOfSchema(candidates);
      }
    } else if (typeName === 'ZodIntersection') {
      const resolved = resolveIntersection(unwrapped);
      if (!resolved?.shape?.[segment]) return null;
      current = resolved.shape[segment];
    } else {
      return null;
    }
  }

  return current;
}

/** Origin hints are mutation metadata, not nullable HTTP header values.
 * Strip them from a validation-only copy, leaving the outgoing payload intact. */
function stripMcpHeaderIdentityHintsForValidation(fieldPath: string, value: unknown): unknown {
  const segments = fieldPath.split('.');
  if (
    segments[0] !== 'mcpServers' ||
    segments.length > 3 ||
    value == null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return value;
  }
  const entries = Object.entries(value);
  if (segments.length === 3) {
    if (segments[2] !== 'headers' && segments[2] !== 'oauth_headers') return value;
    return Object.fromEntries(
      entries.filter(
        ([key, hint]) =>
          key !== PREVIOUS_IDENTITY_HINT_KEY || (hint !== null && typeof hint !== 'string'),
      ),
    );
  }
  return Object.fromEntries(
    entries.map(([key, child]) => [
      key,
      stripMcpHeaderIdentityHintsForValidation(`${fieldPath}.${key}`, child),
    ]),
  );
}

export function validateFieldValue(
  fieldPath: string,
  value: unknown,
): { success: true } | { success: false; error: string } {
  const segments = fieldPath.split('.');
  const subSchema = resolveSubSchema(configSchema as t.ZodSchemaLike, segments);

  if (!subSchema) return { success: true };

  if (
    typeof subSchema === 'object' &&
    'safeParse' in subSchema &&
    typeof subSchema.safeParse === 'function'
  ) {
    const result = (
      subSchema as {
        safeParse: (v: unknown) => {
          success: boolean;
          error?: { issues: Array<{ message: string; path: (string | number)[] }> };
        };
      }
    ).safeParse(stripMcpHeaderIdentityHintsForValidation(fieldPath, value));
    if (!result.success && result.error) {
      const messages = result.error.issues.map((issue) => {
        const issuePath = issue.path.reduce(
          (path, segment) =>
            typeof segment === 'number' ? `${path}[${segment}]` : `${path}.${segment}`,
          fieldPath,
        );
        return `${issuePath}: ${issue.message}`;
      });
      return { success: false, error: messages.join('; ') || 'Validation failed' };
    }
  }

  return { success: true };
}

export type IndexedArrayPathParseResult =
  | { kind: 'indexed'; arrayPath: string; index: number }
  | { kind: 'invalid'; error: string }
  | { kind: 'none' };

/** Descend one object/record/union/intersection segment. Does not enter arrays. */
function descendNonArraySegment(schema: t.ZodSchemaLike, segment: string): t.ZodSchemaLike | null {
  const unwrapped = unwrapSchema(schema);
  if (!unwrapped?._def) return null;
  const typeName = unwrapped._def.typeName;

  if (unwrapped.shape && typeof unwrapped.shape === 'object') {
    return unwrapped.shape[segment] ?? null;
  }
  if (typeName === 'ZodRecord') {
    return (unwrapped._def as t.ZodDef & { valueType?: t.ZodSchemaLike }).valueType ?? null;
  }
  if (typeName === 'ZodUnion') {
    const options = unwrapped._def.options ?? [];
    const candidates: t.ZodSchemaLike[] = [];
    for (const opt of options) {
      const resolved = descendNonArraySegment(opt, segment);
      if (resolved) candidates.push(resolved);
    }
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    return anyOfSchema(candidates);
  }
  if (typeName === 'ZodIntersection') {
    const resolved = resolveIntersection(unwrapped);
    return resolved?.shape?.[segment] ?? null;
  }
  return null;
}

/**
 * Whether a schema node can materialize as an array and/or record, including
 * through unions such as `string | string[]` or `string[] | Record<string, …>`.
 */
function schemaContainerFlags(schema: t.ZodSchemaLike): {
  canBeArray: boolean;
  canBeRecord: boolean;
} {
  const unwrapped = unwrapSchema(schema);
  if (!unwrapped?._def) return { canBeArray: false, canBeRecord: false };
  const typeName = unwrapped._def.typeName;
  if (typeName === 'ZodArray') return { canBeArray: true, canBeRecord: false };
  if (typeName === 'ZodRecord') return { canBeArray: false, canBeRecord: true };
  if (typeName === 'ZodUnion') {
    let canBeArray = false;
    let canBeRecord = false;
    for (const opt of unwrapped._def.options ?? []) {
      const flags = schemaContainerFlags(opt);
      canBeArray = canBeArray || flags.canBeArray;
      canBeRecord = canBeRecord || flags.canBeRecord;
    }
    return { canBeArray, canBeRecord };
  }
  return { canBeArray: false, canBeRecord: false };
}

function parseTerminalArrayIndex(
  fieldPath: string,
  arrayPath: string,
  indexSegment: string,
): IndexedArrayPathParseResult {
  if (!ARRAY_INDEX_KEY_RE.test(indexSegment)) {
    return { kind: 'invalid', error: `Invalid array index in path: ${fieldPath}` };
  }
  const index = Number(indexSegment);
  if (!Number.isSafeInteger(index) || index < 0 || index > MAX_INDEXED_ARRAY_INDEX) {
    return { kind: 'invalid', error: `Invalid array index in path: ${fieldPath}` };
  }
  return { kind: 'indexed', arrayPath, index };
}

/**
 * Classifies a field path as a supported terminal indexed-array edit, an
 * unsupported path that crosses an array, or neither. Only
 * `<arrayPath>.<in-range-index>` may return `indexed`. Any other traversal
 * through a ZodArray — including array variants inside unions — returns
 * `invalid` so LibreChat never receives a dotted path that can replace the
 * array with an object. Array|record unions fail closed on ambiguity.
 */
export function parseIndexedArrayPath(fieldPath: string): IndexedArrayPathParseResult {
  const segments = fieldPath.split('.');
  if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
    return { kind: 'none' };
  }

  let current: t.ZodSchemaLike = configSchema as t.ZodSchemaLike;
  for (let i = 0; i < segments.length; i += 1) {
    const flags = schemaContainerFlags(current);
    if (flags.canBeArray) {
      const remaining = segments.slice(i);
      if (flags.canBeRecord || remaining.length !== 1) {
        return { kind: 'invalid', error: `Unsupported array path: ${fieldPath}` };
      }
      return parseTerminalArrayIndex(fieldPath, segments.slice(0, i).join('.'), remaining[0]);
    }

    const next = descendNonArraySegment(current, segments[i]);
    if (!next) return { kind: 'none' };
    current = next;
  }

  return { kind: 'none' };
}

function assertValidIndexedArrayPaths(paths: Iterable<string>): void {
  for (const fieldPath of paths) {
    const parsed = parseIndexedArrayPath(fieldPath);
    if (parsed.kind === 'invalid') {
      throw new Error(parsed.error);
    }
  }
}

/** Indexed resets are not reconstructed into whole-array writes; reject them. */
export function assertNoIndexedArrayResets(paths: Iterable<string>): void {
  for (const fieldPath of paths) {
    const parsed = parseIndexedArrayPath(fieldPath);
    if (parsed.kind === 'indexed') {
      throw new Error(
        `Indexed array resets are not supported: ${fieldPath}. Reset the whole array or edit the entry instead.`,
      );
    }
    if (parsed.kind === 'invalid') {
      throw new Error(parsed.error);
    }
  }
}

export function toConfigArraySource(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return [...value];
  return toIndexedArrayObjectSource(value);
}

export function toIndexedArrayObjectSource(value: unknown): unknown[] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) return undefined;
  const arrayValue: unknown[] = [];
  for (const [key, entryValue] of Object.entries(value as Record<string, t.ConfigValue>)) {
    if (!ARRAY_INDEX_KEY_RE.test(key)) return undefined;
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index > MAX_INDEXED_ARRAY_INDEX) {
      return undefined;
    }
    arrayValue[index] = entryValue;
  }
  return arrayValue;
}

function overlayArraySource(source: unknown[], overlay: unknown[]): unknown[] {
  const result = [...source];
  for (const key of Object.keys(overlay)) {
    const index = Number(key);
    result[index] = overlay[index];
  }
  return result;
}

function mergeConfigArraySource(source: unknown[], value: unknown): unknown[] {
  if (Array.isArray(value)) return [...value];
  const overlay = toIndexedArrayObjectSource(value);
  return overlay ? overlayArraySource(source, overlay) : source;
}

/**
 * Paths where Mongo array overrides merge with YAML by item identity rather
 * than replacing the inherited array wholesale. Mirrors `ARRAY_MERGE_KEYS` in
 * `@librechat/data-schemas` `resolution.ts`.
 */
const ARRAY_MERGE_KEYS: Record<string, string> = {
  'endpoints.custom': 'name',
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function mergePlainObjects(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const [key, sourceVal] of Object.entries(source)) {
    const targetVal = result[key];
    if (isPlainObject(sourceVal) && isPlainObject(targetVal)) {
      result[key] = mergePlainObjects(targetVal, sourceVal);
    } else {
      result[key] = sourceVal;
    }
  }
  return result;
}

function mergeArrayByKey(target: unknown[], source: unknown[], keyField: string): unknown[] {
  const sourceByKey = new Map<unknown, Record<string, unknown>>();
  for (const item of source) {
    if (isPlainObject(item)) {
      const key = item[keyField];
      if (key != null) {
        sourceByKey.set(key, item);
      }
    }
  }

  const result: unknown[] = [];
  const seen = new Set<unknown>();

  for (const item of target) {
    if (isPlainObject(item)) {
      const key = item[keyField];
      const override = key != null ? sourceByKey.get(key) : undefined;
      if (override) {
        result.push(mergePlainObjects(item, override));
        seen.add(key);
      } else {
        result.push({ ...item });
      }
    } else {
      result.push(item);
    }
  }

  for (const key of sourceByKey.keys()) {
    if (!seen.has(key)) {
      result.push(mergePlainObjects({}, sourceByKey.get(key)!));
    }
  }

  return result;
}

function mergeEffectiveArrayBaseline(
  arrayPath: string,
  inherited: unknown,
  overlay: unknown,
): unknown[] {
  const baseSource = toConfigArraySource(inherited) ?? [];
  if (overlay === undefined) {
    return baseSource;
  }

  const mergeKey = ARRAY_MERGE_KEYS[arrayPath];
  if (mergeKey && Array.isArray(overlay)) {
    const overlaySource = toConfigArraySource(overlay) ?? [];
    return mergeArrayByKey(baseSource, overlaySource, mergeKey);
  }

  return mergeConfigArraySource(baseSource, overlay);
}

function findSnapshotArrayEntry(
  overlay: unknown,
  arrayPath: string,
  index: number,
  currentEntry: unknown,
): unknown {
  const overlaySource = toConfigArraySource(overlay);
  if (!overlaySource) return undefined;

  const mergeKey = ARRAY_MERGE_KEYS[arrayPath];
  if (mergeKey && isPlainObject(currentEntry)) {
    const key = currentEntry[mergeKey];
    if (key != null) {
      let match: unknown;
      for (const item of overlaySource) {
        if (isPlainObject(item) && item[mergeKey] === key) {
          match = item;
        }
      }
      return match;
    }
  }

  return overlaySource[index];
}

export function mergeConfigArraySources(
  baseValue: unknown,
  overrideValue: unknown,
  pendingValue: unknown,
): unknown[] {
  const baseSource = toConfigArraySource(baseValue) ?? [];
  const overrideSource = mergeConfigArraySource(baseSource, overrideValue);
  return mergeConfigArraySource(overrideSource, pendingValue);
}

/** Shared queryOptions for the schema tree used by command palette search. */
export const configSchemaTreeOptions = queryOptions({
  queryKey: ['configSchemaTree'],
  queryFn: () => getConfigSchemaFields().then((r) => r.tree),
  staleTime: Infinity,
});

export const getConfigSchemaFields = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const tree = extractSchemaTree(configSchema);
    const startupConfigResponse = await apiFetch('/api/config');
    const startupConfig = startupConfigResponse.ok
      ? ((await startupConfigResponse.json()) as { langfuseFanoutEnabled?: boolean })
      : undefined;
    applyLangfuseSchemaVisibility(tree, startupConfig?.langfuseFanoutEnabled);
    for (const section of tree) {
      if (section.key === 'interface' && section.children) {
        section.children = filterInterfacePermissionChildren(section.children);
      }
    }
    const flatFields = flattenTree(tree);
    tree.sort((a, b) => a.key.localeCompare(b.key));

    return { tree, totalFields: flatFields.length, topLevelSections: tree.length };
  } catch (error) {
    console.error('Failed to extract schema fields:', error);
    throw new Error(
      `Failed to extract schema fields: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
});

export const parseImportedYaml = createServerFn({ method: 'POST' })
  .inputValidator(z.object({ yamlContent: z.string() }))
  .handler(async ({ data }: { data: { yamlContent: string } }) => {
    let rawConfig: unknown;
    try {
      rawConfig = yaml.load(data.yamlContent, { schema: yaml.JSON_SCHEMA });
    } catch (parseError) {
      console.error('Failed to parse imported YAML content:', parseError);
      return {
        success: false,
        error: 'Invalid YAML syntax. Please check the content for syntax errors.',
        validationErrors: undefined,
        appConfig: null,
      };
    }

    if (!rawConfig || typeof rawConfig !== 'object') {
      return {
        success: false,
        error: 'YAML did not produce a valid configuration object',
        validationErrors: undefined,
        appConfig: null,
      };
    }

    const result = configSchema.safeParse(rawConfig);

    if (!result.success) {
      return {
        success: false,
        error: 'Config validation failed',
        validationErrors: result.error.errors.map(
          (e: { path: (string | number)[]; message: string }) => ({
            path: e.path.join('.'),
            message: e.message,
          }),
        ),
        appConfig: null,
      };
    }

    /**
     * `librechat-data-provider` and `@librechat/data-schemas` both migrated
     * to tsdown (upstream #13578, #13597) and now ship dual `.d.cts` + `.d.mts`
     * declaration files. Under `moduleResolution: bundler`, TS treats
     * `TCustomConfig` resolved through one declaration path as nominally
     * distinct from `TCustomConfig` resolved through the other, even when
     * structurally identical. That collision shows up here as "Two different
     * types with this name exist, but they are unrelated" in the ServerFn
     * registration. The consumer (ImportYamlDialog) treats appConfig as
     * `Record<string, ConfigValue>`, so widening the return is the local fix.
     */
    return {
      success: true,
      error: undefined,
      validationErrors: undefined,
      appConfig: result.data as Record<string, t.ConfigValue>,
    };
  });

function getFieldDefault(schema: t.ZodSchemaLike): { hasDefault: boolean; value: unknown } {
  let current = schema;
  while (current?._def) {
    if (current._def.typeName === 'ZodDefault') {
      const defVal = (current._def as unknown as { defaultValue: () => unknown }).defaultValue;
      return { hasDefault: true, value: typeof defVal === 'function' ? defVal() : defVal };
    }
    const next =
      current._def.typeName === 'ZodEffects' ? current._def.schema : current._def.innerType;
    if (!next) break;
    current = next;
  }
  return { hasDefault: false, value: undefined };
}

function extractSchemaDefaults(schema: t.ZodSchemaLike): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (!schema || typeof schema !== 'object' || !('shape' in schema) || !schema.shape) return result;

  for (const [key, fieldSchema] of Object.entries(
    schema.shape as Record<string, t.ZodSchemaLike>,
  )) {
    const { hasDefault, value } = getFieldDefault(fieldSchema);
    if (hasDefault) {
      result[key] = value;
      continue;
    }

    const inner = unwrapSchema(fieldSchema);

    if (inner && typeof inner === 'object' && 'shape' in inner) {
      const nested = extractSchemaDefaults(inner);
      if (Object.keys(nested).length > 0) {
        result[key] = nested;
      }
    }
  }
  return result;
}

function computeConfiguredPaths(
  config: Record<string, t.ConfigValue>,
  defaults: Record<string, unknown>,
): string[] {
  const flatConfig = flattenObject(config);
  const flatDefaults = flattenObject(defaults as Record<string, t.ConfigValue>);
  const configured: string[] = [];
  for (const [path, value] of Object.entries(flatConfig)) {
    if (value === '' || value === null || value === undefined) continue;
    if (!(path in flatDefaults)) {
      configured.push(path);
      continue;
    }
    const defaultVal = flatDefaults[path];
    if (value === defaultVal) continue;
    if (JSON.stringify(value) === JSON.stringify(defaultVal)) continue;
    configured.push(path);
  }
  return configured;
}

/** Maps AppService output keys back to canonical config schema keys.
 *  `interfaceConfig` → `interface` still flows through; permission fields
 *  within `interface` are stripped in `normalizeAppServiceKeys` below. */
const APP_SERVICE_KEY_MAP: Record<string, string> = {
  interfaceConfig: 'interface',
  turnstileConfig: 'turnstile',
  mcpConfig: 'mcpServers',
};

const AZURE_OPENAI_DERIVED_KEYS = new Set([
  'errors',
  'isValid',
  'groupMap',
  'modelNames',
  'modelGroupMap',
  'assistantModels',
  'serverless',
  'instanceName',
  'deploymentName',
]);

function normalizeEndpointValue(value: t.ConfigValue): t.ConfigValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const obj = value as Record<string, t.ConfigValue>;
  if ('groupMap' in obj && 'isValid' in obj) {
    const groupMap = obj.groupMap;
    const cleaned: Record<string, t.ConfigValue> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (AZURE_OPENAI_DERIVED_KEYS.has(k)) continue;
      cleaned[k] = v;
    }
    if (groupMap && typeof groupMap === 'object' && !Array.isArray(groupMap)) {
      cleaned.groups = Object.entries(groupMap as Record<string, t.ConfigValue>).map(
        ([group, config]) => ({
          group,
          ...(typeof config === 'object' && config !== null && !Array.isArray(config)
            ? (config as Record<string, t.ConfigValue>)
            : {}),
        }),
      );
    }
    return cleaned;
  }
  return value;
}

export function normalizeAppServiceKeys(
  raw: Record<string, t.ConfigValue>,
): Record<string, t.ConfigValue> {
  const result: Record<string, t.ConfigValue> = {};
  for (const [key, value] of Object.entries(raw)) {
    result[APP_SERVICE_KEY_MAP[key] ?? key] = value;
  }
  if (
    result.interface &&
    typeof result.interface === 'object' &&
    !Array.isArray(result.interface)
  ) {
    result.interface = stripInterfacePermissionFields(
      result.interface as Record<string, unknown>,
    ) as t.ConfigValue;
  }
  if (
    result.endpoints &&
    typeof result.endpoints === 'object' &&
    !Array.isArray(result.endpoints)
  ) {
    const endpoints = { ...(result.endpoints as Record<string, t.ConfigValue>) };
    result.endpoints = endpoints;
    for (const [epKey, epValue] of Object.entries(endpoints)) {
      endpoints[epKey] = normalizeEndpointValue(epValue);
    }
  }
  return result;
}

export const getBaseConfigFn = createServerFn({ method: 'GET' }).handler(async () => {
  const [baseResponse, baseOnlyResponse] = await Promise.all([
    apiFetch('/api/admin/config/base'),
    apiFetch('/api/admin/config/base?baseOnly=true'),
  ]);

  if (!baseResponse.ok) {
    throw new Error(`Failed to fetch base config: ${baseResponse.status}`);
  }

  // `config`, `dbOverrides`, and `dbConfigVersion` all come from this one
  // response so the CAS version is always paired with the exact content it
  // describes — fetching the raw override doc as a second, independent
  // request let a concurrent mutation land in between, pairing stale content
  // with a fresh version (or vice versa) and letting the next save silently
  // pass CAS while overwriting that intervening change.
  const {
    config: rawConfig,
    dbOverrides: rawDbOverrides,
    dbConfigVersion: rawDbConfigVersion,
    dbIsActive: rawDbIsActive,
    effectiveTenantId,
  } = (await baseResponse.json()) as {
    config: Record<string, t.ConfigValue>;
    dbOverrides?: Record<string, t.ConfigValue>;
    dbConfigVersion: number | null;
    dbIsActive?: boolean | null;
    effectiveTenantId?: string;
  };
  if (typeof effectiveTenantId !== 'string') {
    throw new Error('Base config response is missing its effective tenant');
  }
  const config = normalizeAppServiceKeys(rawConfig);
  const dbOverrides = rawDbOverrides;
  // `null` means the base document doesn't exist yet (absent) — matches the
  // `expectedVersion: null` the atomic endpoint expects for a first-ever save.
  const dbConfigVersion = rawDbConfigVersion ?? null;

  let configuredFromBase: string[] = [];
  let flatDefaults: Record<string, t.ConfigValue> = {};
  try {
    const schemaDefaults = extractSchemaDefaults(configSchema as t.ZodSchemaLike);
    flatDefaults = flattenObject(schemaDefaults as Record<string, t.ConfigValue>);
    configuredFromBase = computeConfiguredPaths(config, schemaDefaults);
  } catch (e) {
    console.warn('[getBaseConfigFn] Failed to compute schema defaults:', e);
  }

  if (!baseOnlyResponse.ok) {
    throw new Error(`Failed to fetch YAML baseline config: ${baseOnlyResponse.status}`);
  }
  let yamlMcpKeys: string[] | undefined;
  let yamlMcpServers: Record<string, t.ConfigValue> | undefined;
  const { config: baseOnlyRaw } = (await baseOnlyResponse.json()) as {
    config: Record<string, t.ConfigValue>;
  };
  const baseOnly = normalizeAppServiceKeys(baseOnlyRaw);
  const mcp = baseOnly.mcpServers;
  if (mcp && typeof mcp === 'object' && !Array.isArray(mcp)) {
    /** Trust the baseOnly response when it has a valid mcpServers shape. The previous byte-equality fallback against `config.mcpServers` was a defensive heuristic for hypothetical legacy backends that ignore `?baseOnly`, but it false-negatived whenever an admin override happened to be a no-op (e.g. an admin set `title` to a value that already matched YAML), causing the YAML lock affordances to disappear for entries that should stay locked. The deployed LibreChat supports `?baseOnly` directly, so the heuristic is no longer earning its keep. */
    yamlMcpServers = mcp as Record<string, t.ConfigValue>;
    yamlMcpKeys = Object.keys(yamlMcpServers);
  }

  return {
    config,
    dbOverrides,
    dbConfigVersion,
    dbIsActive: rawDbIsActive ?? null,
    effectiveTenantId,
    configuredFromBase,
    schemaDefaults: flatDefaults,
    yamlMcpKeys,
    yamlMcpServers,
  };
});

export const baseConfigOptions = queryOptions({
  queryKey: ['baseConfig'],
  queryFn: () => getBaseConfigFn(),
  staleTime: 30_000,
});

let cachedSchemaPathSet: Set<string> | undefined;
let cachedSecretFieldPathSet: Set<string> | undefined;

/**
 * Index-free schema field paths (e.g. `endpoints.custom.apiKey`), memoized
 * since the schema is static. `extractSchemaTree` bakes `[]`/`{}` markers
 * into array/record element paths for its own tree-walking bookkeeping;
 * strip them so paths match the plain dotted convention `secretPathForPreviewPath`
 * and `stripSecretPreviewValues` expect.
 */
export function getSchemaPathSet(): Set<string> {
  if (!cachedSchemaPathSet) {
    const paths = flattenTree(extractSchemaTree(configSchema)).map((f) =>
      f.path.replace(/\.(\[\]|\{\})/g, ''),
    );
    cachedSchemaPathSet = new Set(paths);
  }
  return cachedSchemaPathSet;
}

/** Schema secret leaf paths (string-typed credential fields), memoized. */
export function getSecretFieldPathSet(): Set<string> {
  if (!cachedSecretFieldPathSet) {
    cachedSecretFieldPathSet = collectSecretFieldPaths(extractSchemaTree(configSchema));
    cachedSecretFieldPathSet.add('langfuse.secretKey');
  }
  return cachedSecretFieldPathSet;
}

export function mergeIndexedArrayEntriesIntoBase(
  entries: Array<{ fieldPath: string; value: unknown }>,
  baseConfig: Record<string, t.ConfigValue>,
  mergedPaths?: Set<string>,
  overlayConfig?: Record<string, t.ConfigValue>,
): Array<{ fieldPath: string; value: unknown }> {
  const indexed = new Map<string, Map<number, unknown>>();
  const rest: Array<{ fieldPath: string; value: unknown }> = [];

  for (const entry of entries) {
    const parsed = parseIndexedArrayPath(entry.fieldPath);
    if (parsed.kind === 'invalid') {
      throw new Error(parsed.error);
    }
    if (parsed.kind === 'indexed') {
      const { arrayPath, index } = parsed;
      if (!indexed.has(arrayPath)) indexed.set(arrayPath, new Map());
      indexed.get(arrayPath)!.set(index, entry.value);
    } else {
      rest.push(entry);
    }
  }

  if (indexed.size === 0) return entries;
  const normalizedBaseConfig = normalizeAppServiceKeys(baseConfig);
  const normalizedOverlayConfig =
    overlayConfig === undefined ? undefined : normalizeAppServiceKeys(overlayConfig);

  for (const [arrayPath, updates] of indexed) {
    const inherited = getConfigNode(normalizedBaseConfig, arrayPath);
    const overlay =
      normalizedOverlayConfig === undefined
        ? undefined
        : getConfigNode(normalizedOverlayConfig, arrayPath);
    const arr =
      normalizedOverlayConfig === undefined
        ? (toConfigArraySource(inherited) ?? [])
        : mergeEffectiveArrayBaseline(arrayPath, inherited, overlay);
    const schemaPaths = getSchemaPathSet();
    const secretFieldPaths = getSecretFieldPathSet();
    for (const [idx, value] of updates) {
      if (idx >= arr.length) {
        throw new Error(
          `Indexed path ${arrayPath}.${idx} is out of range for array of length ${arr.length}`,
        );
      }
      arr[idx] = mergeUntouchedSecrets(
        value,
        findSnapshotArrayEntry(overlay, arrayPath, idx, arr[idx]),
        arrayPath,
        secretFieldPaths,
      );
    }
    for (let idx = 0; idx < arr.length; idx++) {
      if (updates.has(idx)) continue;
      arr[idx] = retainSnapshotSecretsOnly(
        arr[idx],
        findSnapshotArrayEntry(overlay, arrayPath, idx, arr[idx]),
        arrayPath,
        secretFieldPaths,
      );
    }
    const strippedArr = stripSecretPreviewValues(arr as t.ConfigValue[], arrayPath, schemaPaths);
    rest.push({ fieldPath: arrayPath, value: strippedArr });
    mergedPaths?.add(arrayPath);
  }

  return rest;
}

/**
 * Applies indexed edits to a scope overlay without pinning inherited base entries.
 * The effective (base⊕scope) array is used only to resolve index→identity and secrets;
 * the outgoing value is the updated raw scope-owned array.
 */
export function mergeIndexedArrayEntriesIntoScopeOverlay(
  entries: Array<{ fieldPath: string; value: unknown }>,
  baseConfig: Record<string, t.ConfigValue>,
  scopeOverrides: Record<string, t.ConfigValue>,
): Array<{ fieldPath: string; value: unknown }> {
  const indexed = new Map<string, Map<number, unknown>>();
  const rest: Array<{ fieldPath: string; value: unknown }> = [];

  for (const entry of entries) {
    const parsed = parseIndexedArrayPath(entry.fieldPath);
    if (parsed.kind === 'invalid') {
      throw new Error(parsed.error);
    }
    if (parsed.kind === 'indexed') {
      const { arrayPath, index } = parsed;
      if (!indexed.has(arrayPath)) indexed.set(arrayPath, new Map());
      indexed.get(arrayPath)!.set(index, entry.value);
    } else {
      rest.push(entry);
    }
  }

  if (indexed.size === 0) return entries;

  const normalizedBaseConfig = normalizeAppServiceKeys(baseConfig);
  const normalizedScope = normalizeAppServiceKeys(scopeOverrides);
  const schemaPaths = getSchemaPathSet();
  const secretFieldPaths = getSecretFieldPathSet();

  for (const [arrayPath, updates] of indexed) {
    const inherited = getConfigNode(normalizedBaseConfig, arrayPath);
    const overlay = getConfigNode(normalizedScope, arrayPath);
    const effective = mergeEffectiveArrayBaseline(arrayPath, inherited, overlay);
    const mergeKey = ARRAY_MERGE_KEYS[arrayPath];
    const scopeOwned = [...(toConfigArraySource(overlay) ?? [])];
    const updatedScopeIndexes = new Set<number>();

    for (const [idx, value] of updates) {
      if (idx >= effective.length) {
        throw new Error(
          `Indexed path ${arrayPath}.${idx} is out of range for array of length ${effective.length}`,
        );
      }
      const effectiveEntry = effective[idx];
      const merged = mergeUntouchedSecrets(
        value,
        findSnapshotArrayEntry(overlay, arrayPath, idx, effectiveEntry),
        arrayPath,
        secretFieldPaths,
      );

      if (mergeKey && isPlainObject(effectiveEntry)) {
        const key = effectiveEntry[mergeKey];
        if (key == null) {
          throw new Error(
            `Indexed path ${arrayPath}.${idx} cannot be scoped: effective entry is missing "${mergeKey}"`,
          );
        }
        let replaced = false;
        for (let i = 0; i < scopeOwned.length; i += 1) {
          const item = scopeOwned[i];
          if (isPlainObject(item) && item[mergeKey] === key) {
            scopeOwned[i] = merged;
            updatedScopeIndexes.add(i);
            replaced = true;
            break;
          }
        }
        if (!replaced) {
          updatedScopeIndexes.add(scopeOwned.length);
          scopeOwned.push(merged);
        }
      } else {
        // Non-keyed arrays replace by index within the scope-owned source only.
        while (scopeOwned.length <= idx) {
          scopeOwned.push(effective[scopeOwned.length]);
        }
        scopeOwned[idx] = merged;
        updatedScopeIndexes.add(idx);
      }
    }

    for (let i = 0; i < scopeOwned.length; i += 1) {
      if (updatedScopeIndexes.has(i)) continue;
      const item = scopeOwned[i];
      scopeOwned[i] = retainSnapshotSecretsOnly(
        item,
        findSnapshotArrayEntry(overlay, arrayPath, i, item),
        arrayPath,
        secretFieldPaths,
      );
    }

    const strippedArr = stripSecretPreviewValues(
      scopeOwned as t.ConfigValue[],
      arrayPath,
      schemaPaths,
    );
    rest.push({ fieldPath: arrayPath, value: strippedArr });
  }

  return rest;
}

function getConfigNode(config: Record<string, t.ConfigValue>, fieldPath: string): unknown {
  const result = getValueAtPath(config, fieldPath);
  return result.found ? result.value : undefined;
}

async function fetchYamlBaseConfig(
  expectedTenantId: string,
): Promise<Record<string, t.ConfigValue>> {
  const response = await apiFetch(
    '/api/admin/config/base?baseOnly=true',
    undefined,
    expectedTenantId,
  );
  if (!response.ok) {
    throw new Error(`Failed to fetch YAML base config: ${response.status}`);
  }
  const { config } = (await response.json()) as { config: Record<string, t.ConfigValue> };
  return config;
}

function hasIndexedArrayEntry(entries: Array<{ fieldPath: string; value: unknown }>): boolean {
  for (const entry of entries) {
    if (parseIndexedArrayPath(entry.fieldPath).kind === 'indexed') return true;
  }
  return false;
}

function mutationCount(
  entries?: Array<{ fieldPath: string; value: unknown }>,
  resetPaths?: string[],
): number {
  return (entries?.length ?? 0) + (resetPaths?.length ?? 0);
}

export { canonicalizeResetPaths } from './utils/configPaths';

async function postAtomicBaseConfigMutation(body: {
  expectedVersion: number | null;
  expectedTenantId: string;
  cause: t.ConfigRevisionCause;
  resetPaths?: string[];
  entries?: Array<{ fieldPath: string; value: unknown }>;
  overrides?: Record<string, unknown>;
  deleteDocument?: boolean;
  restoreRevisionId?: string;
  isActive?: boolean;
  priority?: number;
}): Promise<void> {
  const response = await apiFetch(
    `/api/admin/config/role/${BASE_CONFIG_PRINCIPAL_ID}/atomic`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    body.expectedTenantId,
  );
  const payload = await response.json().catch(() => ({}));
  if (response.status === 409) {
    throw new ConfigVersionConflictError();
  }
  if (!response.ok) {
    throw new Error(
      (payload as { error?: string }).error ?? `Failed to save base config: ${response.status}`,
    );
  }
}

async function applyBaseConfigMutation(data: {
  entries?: Array<{ fieldPath: string; value: unknown }>;
  resetPaths?: string[];
  expectedVersion: number | null;
  expectedTenantId: string;
}): Promise<{ success: true }> {
  const submittedEntries = data.entries ?? [];
  const submittedResets = canonicalizeResetPaths(data.resetPaths ?? []);
  if (mutationCount(submittedEntries, submittedResets) > MAX_PATCH_MUTATIONS) {
    throw new Error(`combined entries and resetPaths exceed maximum of ${MAX_PATCH_MUTATIONS}`);
  }

  let filtered = submittedEntries.filter((e) => !isInterfacePermissionPath(e.fieldPath));
  const resetPaths = submittedResets.filter((path) => !isInterfacePermissionPath(path));

  if (filtered.length === 0 && resetPaths.length === 0) {
    if (submittedEntries.length === 0 && submittedResets.length === 0) {
      throw new Error(
        'Provide resetPaths, entries, overrides, deleteDocument, or restoreRevisionId',
      );
    }
    await postAtomicBaseConfigMutation({
      expectedVersion: data.expectedVersion,
      expectedTenantId: data.expectedTenantId,
      cause: 'save',
      resetPaths: submittedResets.length > 0 ? submittedResets : undefined,
      entries: submittedEntries.length > 0 ? submittedEntries : undefined,
      priority: 0,
    });
    return { success: true };
  }

  const sections = [
    ...new Set([
      ...filtered.map((e) => e.fieldPath.split('.')[0]),
      ...resetPaths.map((path) => path.split('.')[0]),
    ]),
  ];
  assertValidIndexedArrayPaths(filtered.map((entry) => entry.fieldPath));
  assertNoIndexedArrayResets(resetPaths);
  await requireAllSectionCapabilities(sections);

  const errors: t.FieldValidationError[] = [];
  for (const entry of filtered) {
    const result = validateFieldValue(entry.fieldPath, entry.value);
    if (!result.success) {
      errors.push({ fieldPath: entry.fieldPath, error: result.error });
    }
  }
  if (errors.length > 0) {
    const details = errors.map((e) => `${e.fieldPath}: ${e.error}`).join('; ');
    throw new Error(`Validation failed — ${details}`);
  }

  if (hasIndexedArrayEntry(filtered)) {
    // The array-merge baseline must reflect the current DB state (not the
    // frozen `expectedVersion` the admin loaded) so identity-key merging and
    // secret retention operate on real array contents; the atomic endpoint's
    // own expectedVersion check — not this read — is what rejects the whole
    // mutation if anything actually changed underneath the admin.
    const [yamlConfig, snapshot] = await Promise.all([
      fetchYamlBaseConfig(data.expectedTenantId),
      readAuthenticatedBaseConfigSnapshot(data.expectedTenantId),
    ]);
    if (snapshot.effectiveTenantId !== data.expectedTenantId) {
      throw new ConfigVersionConflictError();
    }
    filtered = mergeIndexedArrayEntriesIntoBase(
      filtered,
      yamlConfig,
      undefined,
      snapshot.overrides,
    );
  }

  await postAtomicBaseConfigMutation({
    expectedVersion: data.expectedVersion,
    expectedTenantId: data.expectedTenantId,
    cause: 'save',
    resetPaths: resetPaths.length > 0 ? resetPaths : undefined,
    entries: filtered.length > 0 ? filtered : undefined,
    priority: 0,
  });
  return { success: true };
}

const baseConfigMutationInput = z
  .object({
    entries: z
      .array(z.object({ fieldPath: safeFieldPath, value: z.unknown() }))
      .max(MAX_PATCH_MUTATIONS)
      .optional(),
    resetPaths: z.array(safeFieldPath).max(MAX_PATCH_MUTATIONS).optional(),
    /**
     * The configVersion the admin's edit session was frozen against when
     * editing began — never re-derived server-side, since a fresh read here
     * would defeat the whole point of the check (see ConfigPage's session
     * freeze). `null` means the session started from an absent document.
     */
    expectedVersion: z.number().int().min(0).nullable(),
    expectedTenantId: z.string(),
  })
  .refine((data) => mutationCount(data.entries, data.resetPaths) <= MAX_PATCH_MUTATIONS, {
    message: `combined entries and resetPaths exceed maximum of ${MAX_PATCH_MUTATIONS}`,
  });

export const saveBaseConfigFn = createServerFn({ method: 'POST' })
  .inputValidator(baseConfigMutationInput)
  .handler(async ({ data }) => applyBaseConfigMutation(data));

/** Full-replace save used by YAML import (intentionally sends the entire config). */
export const importBaseConfigFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      config: z.record(z.string(), z.unknown()),
      /** The configVersion the admin's session was frozen against when the
       *  import action began — never re-derived server-side, since a fresh
       *  read here would defeat stale-administrator detection entirely (see
       *  ConfigPage's session freeze). `null` means the session started from
       *  an absent document. */
      expectedVersion: z.number().int().min(0).nullable(),
      expectedTenantId: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    await requireCapability(SystemCapabilities.MANAGE_CONFIGS);
    const overrides = { ...data.config };
    if (
      overrides.interface &&
      typeof overrides.interface === 'object' &&
      !Array.isArray(overrides.interface)
    ) {
      overrides.interface = stripInterfacePermissionFields(
        overrides.interface as Record<string, unknown>,
      );
    }

    await postAtomicBaseConfigMutation({
      expectedVersion: data.expectedVersion,
      expectedTenantId: data.expectedTenantId,
      cause: 'import',
      overrides,
      priority: 0,
    });
    return { success: true };
  });

export const resetBaseConfigFieldFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      fieldPath: safeFieldPath,
      expectedVersion: z.number().int().min(0).nullable(),
      expectedTenantId: z.string(),
    }),
  )
  .handler(async ({ data }) =>
    applyBaseConfigMutation({
      resetPaths: [data.fieldPath],
      expectedVersion: data.expectedVersion,
      expectedTenantId: data.expectedTenantId,
    }),
  );

/** Resets the entire base config DB override, reverting every value back to
 *  what librechat.yaml defines. The backend retains a versioned empty sentinel
 *  for compare-and-set safety; scope (role/group/user) profiles are untouched. */
export const resetBaseConfigFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      expectedVersion: z.number().int().min(0).nullable(),
      expectedTenantId: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    await requireCapability(SystemCapabilities.MANAGE_CONFIGS);
    await postAtomicBaseConfigMutation({
      expectedVersion: data.expectedVersion,
      expectedTenantId: data.expectedTenantId,
      cause: 'reset',
      deleteDocument: true,
    });
    return { success: true };
  });

export const setBaseConfigActiveFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      isActive: z.boolean(),
      expectedVersion: z.number().int().min(0).nullable(),
      expectedTenantId: z.string(),
    }),
  )
  .handler(async ({ data }) => {
    await requireCapability(SystemCapabilities.MANAGE_CONFIGS);
    await postAtomicBaseConfigMutation({
      expectedVersion: data.expectedVersion,
      expectedTenantId: data.expectedTenantId,
      cause: 'save',
      isActive: data.isActive,
    });
    return { success: true };
  });
