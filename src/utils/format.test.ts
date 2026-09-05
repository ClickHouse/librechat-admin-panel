import { describe, it, expect } from 'vitest';
import {
  serializeKVPairs,
  deepSerializeKVPairs,
  collectRecordFieldPaths,
  isMcpServerHeadersContainerPath,
} from './format';
import { createField } from '@/test/fixtures';

describe('serializeKVPairs', () => {
  it('converts KV pairs to a record', () => {
    const pairs = [
      { key: 'name', value: 'test', valueType: 'string' as const },
      { key: 'count', value: '42', valueType: 'number' as const },
      { key: 'active', value: 'true', valueType: 'boolean' as const },
    ];
    expect(serializeKVPairs(pairs)).toEqual({ name: 'test', count: 42, active: true });
  });

  it('handles json valueType by parsing JSON string', () => {
    const pairs = [{ key: 'config', value: '{"nested": true}', valueType: 'json' as const }];
    expect(serializeKVPairs(pairs)).toEqual({ config: { nested: true } });
  });

  it('falls back to string for invalid json', () => {
    const pairs = [{ key: 'bad', value: '{not json', valueType: 'json' as const }];
    expect(serializeKVPairs(pairs)).toEqual({ bad: '{not json' });
  });

  it('returns non-KV arrays unchanged', () => {
    const arr = ['a', 'b', 'c'];
    expect(serializeKVPairs(arr)).toBe(arr);
  });

  it('returns empty arrays unchanged', () => {
    expect(serializeKVPairs([])).toEqual([]);
  });

  it('returns primitives unchanged', () => {
    expect(serializeKVPairs('hello')).toBe('hello');
    expect(serializeKVPairs(42)).toBe(42);
    expect(serializeKVPairs(true)).toBe(true);
  });

  it('skips dangerous keys', () => {
    const pairs = [
      { key: '__proto__', value: 'bad', valueType: 'string' as const },
      { key: 'safe', value: 'good', valueType: 'string' as const },
    ];
    const result = serializeKVPairs(pairs) as Record<string, unknown>;
    expect(result.safe).toBe('good');
    expect('__proto__' in result).toBe(false);
  });

  it('skips a header literally named __previousIdentity only for an mcpServers headers/oauth_headers path, where it collides with the origin-hint protocol', () => {
    const pairs = [
      { key: '__previousIdentity', value: 'not-a-hint', valueType: 'string' as const },
      { key: 'X-Custom', value: 'value', valueType: 'string' as const },
    ];
    const result = serializeKVPairs(pairs, 'mcpServers.Jira.headers') as Record<string, unknown>;
    expect(result['X-Custom']).toBe('value');
    expect('__previousIdentity' in result).toBe(false);
  });

  it('does not skip __previousIdentity on an unrelated KV field — only mcpServers headers/oauth_headers has a hint protocol to collide with', () => {
    const pairs = [
      { key: '__previousIdentity', value: 'a-real-value', valueType: 'string' as const },
    ];
    expect(serializeKVPairs(pairs, 'endpoints.openAI.headers')).toEqual({
      __previousIdentity: 'a-real-value',
    });
    expect(serializeKVPairs(pairs, 'endpoints.custom.0.addParams')).toEqual({
      __previousIdentity: 'a-real-value',
    });
    expect(serializeKVPairs(pairs)).toEqual({ __previousIdentity: 'a-real-value' });
  });

  it('skips pairs with empty keys', () => {
    const pairs = [
      { key: '', value: 'orphan', valueType: 'string' as const },
      { key: 'valid', value: 'ok', valueType: 'string' as const },
    ];
    expect(serializeKVPairs(pairs)).toEqual({ valid: 'ok' });
  });
});

describe('deepSerializeKVPairs', () => {
  it('serializes nested KV pairs inside an object', () => {
    const value = {
      name: 'Moonshot',
      apiKey: '${KEY}',
      addParams: [
        { key: 'stream', value: 'true', valueType: 'boolean' },
        { key: 'temp', value: '0.7', valueType: 'number' },
      ],
    };
    const result = deepSerializeKVPairs(value) as Record<string, unknown>;
    expect(result.name).toBe('Moonshot');
    expect(result.addParams).toEqual({ stream: true, temp: 0.7 });
  });

  it('serializes KV pairs with json type in nested objects', () => {
    const value = {
      name: 'Test',
      addParams: [{ key: 'config', value: '{"nested": {"deep": true}}', valueType: 'json' }],
    };
    const result = deepSerializeKVPairs(value) as Record<string, unknown>;
    expect(result.addParams).toEqual({ config: { nested: { deep: true } } });
  });

  it('preserves non-KV arrays', () => {
    const value = {
      models: { default: ['model-1', 'model-2'], fetch: true },
    };
    const result = deepSerializeKVPairs(value) as Record<string, unknown>;
    const models = result.models as Record<string, unknown>;
    expect(models.default).toEqual(['model-1', 'model-2']);
    expect(models.fetch).toBe(true);
  });

  it('serializes KV pairs inside array object entries', () => {
    const value = [
      {
        name: 'TestAPI',
        headers: [{ key: 'Authorization', value: 'Bearer ${TOKEN}', valueType: 'string' }],
      },
    ];
    expect(deepSerializeKVPairs(value)).toEqual([
      {
        name: 'TestAPI',
        headers: { Authorization: 'Bearer ${TOKEN}' },
      },
    ]);
  });

  it('handles headers (string-only record) correctly', () => {
    const value = {
      headers: [{ key: 'x-api-key', value: '${KEY}', valueType: 'string' }],
    };
    const result = deepSerializeKVPairs(value) as Record<string, unknown>;
    expect(result.headers).toEqual({ 'x-api-key': '${KEY}' });
  });

  it('returns primitives unchanged', () => {
    expect(deepSerializeKVPairs('hello')).toBe('hello');
    expect(deepSerializeKVPairs(42)).toBe(42);
    expect(deepSerializeKVPairs(null)).toBe(null);
    expect(deepSerializeKVPairs(undefined)).toBe(undefined);
  });

  it('threads basePath into serializeKVPairs so a real __previousIdentity header only gets dropped under an mcpServers headers/oauth_headers path', () => {
    const mcpValue = {
      headers: [{ key: '__previousIdentity', value: 'not-a-hint', valueType: 'string' }],
    };
    const mcpResult = deepSerializeKVPairs(mcpValue, 'mcpServers.Jira') as Record<
      string,
      unknown
    >;
    expect(mcpResult.headers).toEqual({});

    const endpointValue = {
      headers: [{ key: '__previousIdentity', value: 'a-real-value', valueType: 'string' }],
    };
    const endpointResult = deepSerializeKVPairs(endpointValue, 'endpoints.openAI') as Record<
      string,
      unknown
    >;
    expect(endpointResult.headers).toEqual({ __previousIdentity: 'a-real-value' });
  });

  describe('empty KV array at a record-typed path', () => {
    // KeyValueField always represents its value as an array, even once
    // emptied by removing the last row -- serializeKVPairs alone can't tell
    // that apart from any other empty array, since there's no KV-shaped item
    // left to inspect. Record-typed fields (e.g. MCP headers) reject an
    // array on save, so an emptied one must serialize to {} instead.

    it('serializes an emptied record field to {} when its path is registered', () => {
      const recordFieldPaths = new Set(['mcpServers.foo.headers']);
      const value = { headers: [] };
      const result = deepSerializeKVPairs(
        value,
        'mcpServers.foo',
        recordFieldPaths,
      ) as Record<string, unknown>;
      expect(result.headers).toEqual({});
    });

    it('leaves an empty array unchanged when no recordFieldPaths are supplied (backward compatible default)', () => {
      const value = { headers: [] };
      expect((deepSerializeKVPairs(value) as Record<string, unknown>).headers).toEqual([]);
    });

    it('leaves an empty array unchanged when its path is not a registered record field', () => {
      const recordFieldPaths = new Set(['mcpServers.foo.headers']);
      const value = { dropParams: [] };
      const result = deepSerializeKVPairs(value, '', recordFieldPaths) as Record<string, unknown>;
      expect(result.dropParams).toEqual([]);
    });

    it('matches a registered record path through a numeric array index', () => {
      // endpoints.custom.2.headers must match the schema's index-free
      // endpoints.custom.headers registration.
      const recordFieldPaths = new Set(['endpoints.custom.headers']);
      const value = [{ name: 'A' }, { name: 'B', headers: [] }];
      const result = deepSerializeKVPairs(
        value,
        'endpoints.custom',
        recordFieldPaths,
      ) as Array<Record<string, unknown>>;
      expect(result[1].headers).toEqual({});
    });

    it('matches a registered record path through a dynamic mcpServers.<name> key', () => {
      // mcpServers is a record keyed by admin-chosen server name, not a
      // numeric array index, so extractSchemaTree marks its dynamic segment
      // with `{}` (mcpServers.{}.headers) rather than `[]`. The real runtime
      // path for a server named "Jira" is mcpServers.Jira.headers, which
      // stripArrayIndices leaves untouched since "Jira" isn't numeric --
      // this must still match the `{}`-templated registration.
      const fields = [
        createField({
          key: 'mcpServers',
          path: 'mcpServers',
          type: 'record',
          recordValueType: 'complex',
          children: [
            createField({
              key: 'headers',
              path: 'mcpServers.{}.headers',
              type: 'record',
              recordValueType: 'primitive',
            }),
          ],
        }),
      ];
      const recordFieldPaths = collectRecordFieldPaths(fields);
      const value = { headers: [] };
      const result = deepSerializeKVPairs(
        value,
        'mcpServers.Jira',
        recordFieldPaths,
      ) as Record<string, unknown>;
      expect(result.headers).toEqual({});
    });
  });

  it('handles a full custom endpoint object', () => {
    const endpoint = {
      name: 'TestAPI',
      apiKey: '${API_KEY}',
      baseURL: 'https://api.test.com/v1',
      models: { default: ['gpt-4'], fetch: true },
      titleConvo: true,
      titleModel: 'current_model',
      headers: [{ key: 'Authorization', value: 'Bearer ${TOKEN}', valueType: 'string' }],
      addParams: [
        { key: 'stream', value: 'true', valueType: 'boolean' },
        { key: 'config', value: '{"key": "value"}', valueType: 'json' },
      ],
      dropParams: ['stop', 'presence_penalty'],
    };

    const result = deepSerializeKVPairs(endpoint) as Record<string, unknown>;
    expect(result.name).toBe('TestAPI');
    expect(result.models).toEqual({ default: ['gpt-4'], fetch: true });
    expect(result.headers).toEqual({ Authorization: 'Bearer ${TOKEN}' });
    expect(result.addParams).toEqual({ stream: true, config: { key: 'value' } });
    expect(result.dropParams).toEqual(['stop', 'presence_penalty']);
  });
});

describe('collectRecordFieldPaths', () => {
  it('collects the index-free path of a top-level record field', () => {
    const fields = [createField({ key: 'headers', path: 'endpoints.openAI.headers', type: 'record' })];
    expect(collectRecordFieldPaths(fields)).toEqual(new Set(['endpoints.openAI.headers']));
  });

  it('strips array/record markers from a nested record field path', () => {
    const fields = [
      createField({
        key: 'custom',
        path: 'endpoints.custom.[]',
        type: 'array',
        children: [createField({ key: 'headers', path: 'endpoints.custom.[].headers', type: 'record' })],
      }),
    ];
    expect(collectRecordFieldPaths(fields)).toEqual(new Set(['endpoints.custom.headers']));
  });

  it('ignores non-record fields', () => {
    const fields = [
      createField({ key: 'apiKey', path: 'endpoints.openAI.apiKey', type: 'string' }),
      createField({ key: 'models', path: 'endpoints.openAI.models', type: 'array' }),
    ];
    expect(collectRecordFieldPaths(fields)).toEqual(new Set());
  });
});

describe('isMcpServerHeadersContainerPath', () => {
  it('matches mcpServers.<name>.headers and .oauth_headers for any server name', () => {
    expect(isMcpServerHeadersContainerPath('mcpServers.Jira.headers')).toBe(true);
    expect(isMcpServerHeadersContainerPath('mcpServers.Jira.oauth_headers')).toBe(true);
    expect(isMcpServerHeadersContainerPath('mcpServers.Some-Server_1.headers')).toBe(true);
  });

  it('does not match mcpServers.<name>.oauth or .apiKey — those are scalar leaves, not header maps', () => {
    expect(isMcpServerHeadersContainerPath('mcpServers.Jira.oauth')).toBe(false);
    expect(isMcpServerHeadersContainerPath('mcpServers.Jira.apiKey')).toBe(false);
  });

  it('does not match a headers path outside mcpServers', () => {
    expect(isMcpServerHeadersContainerPath('endpoints.openAI.headers')).toBe(false);
    expect(isMcpServerHeadersContainerPath('endpoints.azureOpenAI.groups.0.additionalHeaders')).toBe(
      false,
    );
  });
});
