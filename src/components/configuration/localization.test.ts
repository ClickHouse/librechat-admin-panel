/**
 * Ensures every config field extracted from the schema has a matching
 * locale key in translation.json.  Catches fields that would render
 * their raw key (e.g. `com_config_field_thinkingLevel`) in the UI.
 */
import { describe, it, expect } from 'vitest';
import { configSchema } from 'librechat-data-provider';
import type { ZodSchemaLike } from '@/types/config';
import { extractSchemaTree, flattenTree } from '@/server/config';
import translation from '@/locales/en/translation.json';
import { getArrayItemType } from './utils';

const localeKeys = new Set(Object.keys(translation));

describe('config field localization coverage', () => {
  const tree = extractSchemaTree(configSchema as ZodSchemaLike);
  const allFields = flattenTree(tree);

  it('every schema field has a com_config_field_* locale key', () => {
    const missing: string[] = [];

    for (const field of allFields) {
      const key = `com_config_field_${field.key}`;
      if (!localeKeys.has(key)) {
        missing.push(`${field.key}  →  ${key}`);
      }
    }

    expect(missing, `Missing locale keys:\n  ${missing.join('\n  ')}`).toHaveLength(0);
  });

  it('every array field rendered as a list has a com_config_field_*_item locale key', () => {
    const arrays = allFields.filter(
      (f) => f.isArray && !getArrayItemType(f.type).startsWith('enum('),
    );
    const missing: string[] = [];

    for (const field of arrays) {
      const key = `com_config_field_${field.key}_item`;
      if (!localeKeys.has(key)) {
        missing.push(`${field.key}  →  ${key}`);
      }
    }

    expect(missing, `Missing array-item locale keys:\n  ${missing.join('\n  ')}`).toHaveLength(0);
  });
});
