import { describe, it, expect, vi } from 'vitest';
import { PrincipalType } from 'librechat-data-provider';

vi.mock('./utils/api', () => ({
  apiFetch: vi.fn(async (url: string) => {
    if (url === '/api/admin/config/base') {
      return {
        ok: true,
        json: async () => ({
          config: {
            endpoints: {
              custom: [
                {
                  name: 'first',
                  baseURL: 'https://first.example.com',
                  apiKeyPreview: 'sk-...aaaa',
                },
                {
                  name: 'second',
                  baseURL: 'https://second.example.com',
                  apiKeyPreview: 'sk-...bbbb',
                },
              ],
            },
          },
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({ config: { overrides: {} } }),
    };
  }),
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator: () => ({
      handler: (fn: (...args: unknown[]) => unknown) => fn,
    }),
    handler: (fn: (...args: unknown[]) => unknown) => fn,
  }),
}));

vi.mock('@tanstack/react-query', () => ({
  queryOptions: (opts: unknown) => opts,
}));

import { mergeIndexedArrayEntriesForScope } from './scopes';

describe('mergeIndexedArrayEntriesForScope', () => {
  it('strips secret preview companions from untouched sibling entries after merging', async () => {
    const result = await mergeIndexedArrayEntriesForScope(PrincipalType.ROLE, 'ADMIN', [
      {
        fieldPath: 'endpoints.custom.1',
        value: { name: 'edited', baseURL: 'https://edited.example.com', apiKey: '' },
      },
    ]);

    expect(result).toEqual([
      {
        fieldPath: 'endpoints.custom',
        value: [
          { name: 'first', baseURL: 'https://first.example.com' },
          { name: 'edited', baseURL: 'https://edited.example.com', apiKey: '' },
        ],
      },
    ]);
  });
});
