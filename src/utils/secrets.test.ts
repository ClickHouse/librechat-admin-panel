import { describe, it, expect } from 'vitest';
import {
  toSecretPreviewKey,
  getSecretPreviewValue,
  secretPathForPreviewPath,
  mapSecretPreviewPaths,
  stripSecretPreviewValues,
  mergeUntouchedSecrets,
  retainSnapshotSecretsOnly,
  collectSecretFieldPaths,
  isSecretFieldPath,
  filterSecretPreviewFields,
} from './secrets';
import { createField } from '@/test/fixtures';

describe('toSecretPreviewKey', () => {
  it('capitalizes the key behind a display prefix', () => {
    expect(toSecretPreviewKey('apiKey')).toBe('apiKeyPreview');
    expect(toSecretPreviewKey('serperApiKey')).toBe('serperApiKeyPreview');
    expect(toSecretPreviewKey('secretKey')).toBe('secretKeyPreview');
  });
});

describe('getSecretPreviewValue', () => {
  it('returns the sibling display companion for a redacted secret', () => {
    expect(getSecretPreviewValue({ apiKeyPreview: 'sk-mist...4321' }, 'apiKey')).toBe(
      'sk-mist...4321',
    );
  });

  it('treats an empty display companion as not configured', () => {
    expect(getSecretPreviewValue({ apiKeyPreview: '' }, 'apiKey')).toBeUndefined();
  });

  it('returns undefined for missing companions and non-object parents', () => {
    expect(getSecretPreviewValue({ baseURL: 'x' }, 'apiKey')).toBeUndefined();
    expect(getSecretPreviewValue('sk-real', 'apiKey')).toBeUndefined();
    expect(getSecretPreviewValue(null, 'apiKey')).toBeUndefined();
    expect(getSecretPreviewValue(['apiKeyPreview'], 'apiKey')).toBeUndefined();
  });
});

describe('secretPathForPreviewPath', () => {
  const schemaPaths = new Set(['ocr.apiKey', 'webSearch.serperApiKey', 'langfuse.secretKey']);

  it('maps a display companion path to its schema secret path', () => {
    expect(secretPathForPreviewPath('ocr.apiKeyPreview', schemaPaths)).toBe('ocr.apiKey');
    expect(secretPathForPreviewPath('webSearch.serperApiKeyPreview', schemaPaths)).toBe(
      'webSearch.serperApiKey',
    );
    expect(secretPathForPreviewPath('langfuse.secretKeyPreview', schemaPaths)).toBe(
      'langfuse.secretKey',
    );
  });

  it('rejects preview-shaped paths without a matching schema secret', () => {
    expect(secretPathForPreviewPath('ocr.fooPreview', schemaPaths)).toBeNull();
    expect(secretPathForPreviewPath('interface.modelDisplayLabelPreview', schemaPaths)).toBeNull();
    expect(secretPathForPreviewPath('ocr.apiKey', schemaPaths)).toBeNull();
  });

  it('maps an array-entry preview path to its index-free schema secret path', () => {
    const arraySchemaPaths = new Set(['endpoints.custom.apiKey']);
    expect(secretPathForPreviewPath('endpoints.custom.0.apiKeyPreview', arraySchemaPaths)).toBe(
      'endpoints.custom.0.apiKey',
    );
    expect(secretPathForPreviewPath('endpoints.custom.12.apiKeyPreview', arraySchemaPaths)).toBe(
      'endpoints.custom.12.apiKey',
    );
  });
});

describe('mapSecretPreviewPaths', () => {
  it('replaces display companion paths and passes other paths through', () => {
    const schemaPaths = new Set(['ocr.apiKey']);
    const mapped = mapSecretPreviewPaths(['ocr.apiKeyPreview', 'ocr.baseURL'], schemaPaths);
    expect(mapped).toEqual(new Set(['ocr.apiKey', 'ocr.baseURL']));
  });
});

describe('stripSecretPreviewValues', () => {
  const schemaPaths = new Set([
    'ocr.apiKey',
    'speech.tts.openai.apiKey',
    'endpoints.custom.apiKey',
  ]);

  it('removes display companion strings from object values', () => {
    const value = { apiKeyPreview: 'sk-mist...4321', model: 'tts-1' };
    expect(stripSecretPreviewValues(value, 'speech.tts.openai', schemaPaths)).toEqual({
      model: 'tts-1',
    });
  });

  it('recurses through nested objects from the edit root', () => {
    const value = { tts: { openai: { apiKeyPreview: 'sk-abc...1111', model: 'tts-1' } } };
    expect(stripSecretPreviewValues(value, 'speech', schemaPaths)).toEqual({
      tts: { openai: { model: 'tts-1' } },
    });
  });

  it('recurses through array entries', () => {
    const value = [{ name: 'ep', apiKeyPreview: 'sk-abc...1111' }];
    expect(stripSecretPreviewValues(value, 'endpoints.custom', schemaPaths)).toEqual([
      { name: 'ep' },
    ]);
  });

  it('keeps non-string values under display-shaped keys', () => {
    const value = { apiKeyPreview: { nested: true } };
    expect(stripSecretPreviewValues(value, 'ocr', schemaPaths)).toEqual({
      apiKeyPreview: { nested: true },
    });
  });

  it('keeps preview-shaped keys with no matching schema secret', () => {
    const value = { fooPreview: 'bar', apiKey: 'typed-by-admin' };
    expect(stripSecretPreviewValues(value, 'ocr', schemaPaths)).toEqual(value);
  });

  it('passes primitives through untouched', () => {
    expect(stripSecretPreviewValues('sk-typed', 'ocr.apiKey', schemaPaths)).toBe('sk-typed');
    expect(stripSecretPreviewValues(7, 'ocr.apiKey', schemaPaths)).toBe(7);
    expect(stripSecretPreviewValues(null, 'ocr.apiKey', schemaPaths)).toBeNull();
  });
});

describe('mergeUntouchedSecrets', () => {
  const secretFieldPaths = collectSecretFieldPaths([
    createField({
      key: 'custom',
      path: 'endpoints.custom',
      isArray: true,
      children: [
        createField({ key: 'name', type: 'string', path: 'endpoints.custom.name' }),
        createField({ key: 'baseURL', type: 'string', path: 'endpoints.custom.baseURL' }),
        createField({ key: 'apiKey', type: 'string', path: 'endpoints.custom.apiKey' }),
        createField({
          key: 'headers',
          type: 'record',
          path: 'endpoints.custom.headers',
          recordValueType: 'primitive',
        }),
      ],
    }),
  ]);

  it('copies omitted snapshot secrets into the edited object', () => {
    expect(
      mergeUntouchedSecrets(
        { name: 'b', baseURL: 'https://edited.example.com', apiKeyPreview: 'sk-...bbbb' },
        { name: 'b', apiKey: 'mongo-key' },
        'endpoints.custom',
        secretFieldPaths,
      ),
    ).toEqual({
      name: 'b',
      baseURL: 'https://edited.example.com',
      apiKeyPreview: 'sk-...bbbb',
      apiKey: 'mongo-key',
    });
  });

  it('keeps an explicitly supplied secret including an empty string', () => {
    expect(
      mergeUntouchedSecrets(
        { name: 'b', apiKey: '' },
        { name: 'b', apiKey: 'mongo-key' },
        'endpoints.custom',
        secretFieldPaths,
      ),
    ).toEqual({ name: 'b', apiKey: '' });
    expect(
      mergeUntouchedSecrets(
        { name: 'b', apiKey: 'new-key' },
        { name: 'b', apiKey: 'mongo-key' },
        'endpoints.custom',
        secretFieldPaths,
      ),
    ).toEqual({ name: 'b', apiKey: 'new-key' });
  });

  it('does not copy non-secret snapshot fields', () => {
    expect(
      mergeUntouchedSecrets(
        { name: 'b', baseURL: 'https://edited.example.com' },
        { name: 'b', baseURL: 'https://mongo.example.com', apiKey: 'mongo-key' },
        'endpoints.custom',
        secretFieldPaths,
      ),
    ).toEqual({
      name: 'b',
      baseURL: 'https://edited.example.com',
      apiKey: 'mongo-key',
    });
  });

  it('does not treat non-secret fields as secrets when the schema includes them', () => {
    expect(isSecretFieldPath('endpoints.custom.baseURL', secretFieldPaths)).toBe(false);
    expect(isSecretFieldPath('endpoints.custom.name', secretFieldPaths)).toBe(false);
    expect(isSecretFieldPath('endpoints.custom.apiKey', secretFieldPaths)).toBe(true);
    expect(isSecretFieldPath('endpoints.custom.headers.Authorization', secretFieldPaths)).toBe(
      true,
    );
    expect(isSecretFieldPath('endpoints.custom.headers', secretFieldPaths)).toBe(false);
    expect(
      mergeUntouchedSecrets(
        { name: 'b', baseURL: 'https://edited.example.com' },
        { name: 'b', baseURL: 'https://mongo.example.com', apiKey: 'mongo-key' },
        'endpoints.custom',
        secretFieldPaths,
      ),
    ).toEqual({
      name: 'b',
      baseURL: 'https://edited.example.com',
      apiKey: 'mongo-key',
    });
  });

  it('restores an omitted headers container from the snapshot wholesale', () => {
    expect(
      mergeUntouchedSecrets(
        {
          name: 'b',
          baseURL: 'https://edited.example.com',
        },
        {
          name: 'b',
          headers: { Authorization: 'Bearer mongo', 'X-Custom': 'old' },
        },
        'endpoints.custom',
        secretFieldPaths,
      ),
    ).toEqual({
      name: 'b',
      baseURL: 'https://edited.example.com',
      headers: { Authorization: 'Bearer mongo', 'X-Custom': 'old' },
    });
  });

  it('treats an explicit empty headers object as clearing all credentials', () => {
    expect(
      mergeUntouchedSecrets(
        {
          name: 'b',
          baseURL: 'https://edited.example.com',
          headers: {},
        },
        {
          name: 'b',
          headers: { Authorization: 'Bearer mongo', 'X-Custom': 'old' },
        },
        'endpoints.custom',
        secretFieldPaths,
      ),
    ).toEqual({
      name: 'b',
      baseURL: 'https://edited.example.com',
      headers: {},
    });
  });

  it('does not restore a deleted header when another header is retained', () => {
    expect(
      mergeUntouchedSecrets(
        {
          name: 'b',
          baseURL: 'https://edited.example.com',
          headers: { 'X-Custom': 'edited' },
        },
        {
          name: 'b',
          headers: { Authorization: 'Bearer mongo', 'X-Custom': 'old' },
        },
        'endpoints.custom',
        secretFieldPaths,
      ),
    ).toEqual({
      name: 'b',
      baseURL: 'https://edited.example.com',
      headers: { 'X-Custom': 'edited' },
    });
  });
});

describe('retainSnapshotSecretsOnly', () => {
  const secretFieldPaths = new Set([
    'endpoints.custom.apiKey',
    'endpoints.custom.headers.*',
  ]);

  it('drops YAML-only secrets from untouched entries', () => {
    expect(
      retainSnapshotSecretsOnly(
        { name: 'a', baseURL: 'https://a.example.com', apiKey: 'yaml-a' },
        undefined,
        'endpoints.custom',
        secretFieldPaths,
      ),
    ).toEqual({ name: 'a', baseURL: 'https://a.example.com' });
  });

  it('keeps secrets sourced from the Mongo snapshot', () => {
    expect(
      retainSnapshotSecretsOnly(
        { name: 'd', baseURL: 'https://d.example.com', apiKey: 'yaml-only' },
        { name: 'd', apiKey: 'mongo-d' },
        'endpoints.custom',
        secretFieldPaths,
      ),
    ).toEqual({ name: 'd', baseURL: 'https://d.example.com', apiKey: 'mongo-d' });
  });

  it('drops YAML-only dynamic header credentials recursively', () => {
    expect(
      retainSnapshotSecretsOnly(
        {
          name: 'a',
          headers: { Authorization: 'Bearer yaml', 'X-Custom': 'yaml' },
        },
        undefined,
        'endpoints.custom',
        secretFieldPaths,
      ),
    ).toEqual({ name: 'a' });
  });

  it('keeps only snapshot-sourced header credentials', () => {
    expect(
      retainSnapshotSecretsOnly(
        {
          name: 'd',
          headers: { Authorization: 'Bearer yaml', 'X-Custom': 'yaml' },
        },
        { name: 'd', headers: { Authorization: 'Bearer mongo' } },
        'endpoints.custom',
        secretFieldPaths,
      ),
    ).toEqual({
      name: 'd',
      headers: { Authorization: 'Bearer mongo' },
    });
  });

  it('preserves numeric credential-record keys through array-index normalization', () => {
    expect(isSecretFieldPath('endpoints.custom.0.headers.123', secretFieldPaths)).toBe(true);
    expect(isSecretFieldPath('endpoints.custom.headers.123', secretFieldPaths)).toBe(true);

    expect(
      retainSnapshotSecretsOnly(
        {
          name: 'a',
          headers: { 123: 'Bearer yaml', Authorization: 'Bearer yaml-auth' },
        },
        undefined,
        'endpoints.custom',
        secretFieldPaths,
      ),
    ).toEqual({ name: 'a' });

    expect(
      mergeUntouchedSecrets(
        { name: 'b', baseURL: 'https://edited.example.com' },
        { name: 'b', headers: { 123: 'Bearer mongo' } },
        'endpoints.custom',
        secretFieldPaths,
      ),
    ).toEqual({
      name: 'b',
      baseURL: 'https://edited.example.com',
      headers: { 123: 'Bearer mongo' },
    });
  });

  it('preserves dotted credential-record keys without treating dots as path segments', () => {
    expect(isSecretFieldPath('endpoints.custom.0.headers.X.Foo', secretFieldPaths)).toBe(true);
    expect(isSecretFieldPath('endpoints.custom.headers.X.Foo', secretFieldPaths)).toBe(true);

    expect(
      retainSnapshotSecretsOnly(
        {
          name: 'a',
          headers: { 'X.Foo': 'Bearer yaml', Authorization: 'Bearer yaml-auth' },
        },
        undefined,
        'endpoints.custom',
        secretFieldPaths,
      ),
    ).toEqual({ name: 'a' });

    expect(
      mergeUntouchedSecrets(
        { name: 'b', baseURL: 'https://edited.example.com' },
        { name: 'b', headers: { 'X.Foo': 'Bearer mongo' } },
        'endpoints.custom',
        secretFieldPaths,
      ),
    ).toEqual({
      name: 'b',
      baseURL: 'https://edited.example.com',
      headers: { 'X.Foo': 'Bearer mongo' },
    });
  });
});

describe('filterSecretPreviewFields', () => {
  it('drops display companions of a sibling secret field', () => {
    const fields = [
      createField({ key: 'apiKey', type: 'string' }),
      createField({ key: 'apiKeyPreview', type: 'string' }),
      createField({ key: 'baseURL', type: 'string' }),
    ];
    expect(filterSecretPreviewFields(fields).map((f) => f.key)).toEqual(['apiKey', 'baseURL']);
  });

  it('keeps preview-shaped fields without a sibling secret', () => {
    const fields = [createField({ key: 'modelDisplayLabelPreview', type: 'string' })];
    expect(filterSecretPreviewFields(fields)).toEqual(fields);
  });

  it('keeps non-string display-shaped fields', () => {
    const fields = [
      createField({ key: 'apiKey', type: 'string' }),
      createField({ key: 'apiKeyPreview', type: 'object', isObject: true }),
    ];
    expect(filterSecretPreviewFields(fields)).toHaveLength(2);
  });
});
