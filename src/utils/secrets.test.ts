import { describe, it, expect } from 'vitest';
import {
  toSecretDisplayKey,
  getSecretDisplayValue,
  secretPathForDisplayPath,
  mapSecretDisplayPaths,
  stripSecretDisplayValues,
  filterSecretDisplayFields,
} from './secrets';
import { createField } from '@/test/fixtures';

describe('toSecretDisplayKey', () => {
  it('capitalizes the key behind a display prefix', () => {
    expect(toSecretDisplayKey('apiKey')).toBe('displayApiKey');
    expect(toSecretDisplayKey('serperApiKey')).toBe('displaySerperApiKey');
    expect(toSecretDisplayKey('secretKey')).toBe('displaySecretKey');
  });
});

describe('getSecretDisplayValue', () => {
  it('returns the sibling display companion for a redacted secret', () => {
    expect(getSecretDisplayValue({ displayApiKey: 'sk-mist...4321' }, 'apiKey')).toBe(
      'sk-mist...4321',
    );
  });

  it('treats an empty display companion as not configured', () => {
    expect(getSecretDisplayValue({ displayApiKey: '' }, 'apiKey')).toBeUndefined();
  });

  it('returns undefined for missing companions and non-object parents', () => {
    expect(getSecretDisplayValue({ baseURL: 'x' }, 'apiKey')).toBeUndefined();
    expect(getSecretDisplayValue('sk-real', 'apiKey')).toBeUndefined();
    expect(getSecretDisplayValue(null, 'apiKey')).toBeUndefined();
    expect(getSecretDisplayValue(['displayApiKey'], 'apiKey')).toBeUndefined();
  });
});

describe('secretPathForDisplayPath', () => {
  const schemaPaths = new Set(['ocr.apiKey', 'webSearch.serperApiKey', 'langfuse.secretKey']);

  it('maps a display companion path to its schema secret path', () => {
    expect(secretPathForDisplayPath('ocr.displayApiKey', schemaPaths)).toBe('ocr.apiKey');
    expect(secretPathForDisplayPath('webSearch.displaySerperApiKey', schemaPaths)).toBe(
      'webSearch.serperApiKey',
    );
    expect(secretPathForDisplayPath('langfuse.displaySecretKey', schemaPaths)).toBe(
      'langfuse.secretKey',
    );
  });

  it('rejects display-shaped paths without a matching schema secret', () => {
    expect(secretPathForDisplayPath('ocr.displayFoo', schemaPaths)).toBeNull();
    expect(secretPathForDisplayPath('interface.modelDisplayLabel', schemaPaths)).toBeNull();
    expect(secretPathForDisplayPath('ocr.apiKey', schemaPaths)).toBeNull();
  });
});

describe('mapSecretDisplayPaths', () => {
  it('replaces display companion paths and passes other paths through', () => {
    const schemaPaths = new Set(['ocr.apiKey']);
    const mapped = mapSecretDisplayPaths(['ocr.displayApiKey', 'ocr.baseURL'], schemaPaths);
    expect(mapped).toEqual(new Set(['ocr.apiKey', 'ocr.baseURL']));
  });
});

describe('stripSecretDisplayValues', () => {
  const schemaPaths = new Set([
    'ocr.apiKey',
    'speech.tts.openai.apiKey',
    'endpoints.custom.apiKey',
  ]);

  it('removes display companion strings from object values', () => {
    const value = { displayApiKey: 'sk-mist...4321', model: 'tts-1' };
    expect(stripSecretDisplayValues(value, 'speech.tts.openai', schemaPaths)).toEqual({
      model: 'tts-1',
    });
  });

  it('recurses through nested objects from the edit root', () => {
    const value = { tts: { openai: { displayApiKey: 'sk-abc...1111', model: 'tts-1' } } };
    expect(stripSecretDisplayValues(value, 'speech', schemaPaths)).toEqual({
      tts: { openai: { model: 'tts-1' } },
    });
  });

  it('recurses through array entries', () => {
    const value = [{ name: 'ep', displayApiKey: 'sk-abc...1111' }];
    expect(stripSecretDisplayValues(value, 'endpoints.custom', schemaPaths)).toEqual([
      { name: 'ep' },
    ]);
  });

  it('keeps non-string values under display-shaped keys', () => {
    const value = { displayApiKey: { nested: true } };
    expect(stripSecretDisplayValues(value, 'ocr', schemaPaths)).toEqual({
      displayApiKey: { nested: true },
    });
  });

  it('keeps display-shaped keys with no matching schema secret', () => {
    const value = { displayFoo: 'bar', apiKey: 'typed-by-admin' };
    expect(stripSecretDisplayValues(value, 'ocr', schemaPaths)).toEqual(value);
  });

  it('passes primitives through untouched', () => {
    expect(stripSecretDisplayValues('sk-typed', 'ocr.apiKey', schemaPaths)).toBe('sk-typed');
    expect(stripSecretDisplayValues(7, 'ocr.apiKey', schemaPaths)).toBe(7);
    expect(stripSecretDisplayValues(null, 'ocr.apiKey', schemaPaths)).toBeNull();
  });
});

describe('filterSecretDisplayFields', () => {
  it('drops display companions of a sibling secret field', () => {
    const fields = [
      createField({ key: 'apiKey', type: 'string' }),
      createField({ key: 'displayApiKey', type: 'string' }),
      createField({ key: 'baseURL', type: 'string' }),
    ];
    expect(filterSecretDisplayFields(fields).map((f) => f.key)).toEqual(['apiKey', 'baseURL']);
  });

  it('keeps display-shaped fields without a sibling secret', () => {
    const fields = [createField({ key: 'displayLabel', type: 'string' })];
    expect(filterSecretDisplayFields(fields)).toEqual(fields);
  });

  it('keeps non-string display-shaped fields', () => {
    const fields = [
      createField({ key: 'apiKey', type: 'string' }),
      createField({ key: 'displayApiKey', type: 'object', isObject: true }),
    ];
    expect(filterSecretDisplayFields(fields)).toHaveLength(2);
  });
});
