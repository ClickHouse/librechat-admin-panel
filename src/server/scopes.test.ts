import { PrincipalType } from 'librechat-data-provider';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.fn(async (url: string) => {
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
              {
                name: 'third',
                baseURL: 'https://third.example.com',
                apiKeyPreview: 'sk-...cccc',
              },
            ],
          },
        },
      }),
    };
  }
  if (url.includes('/api/admin/config/role/')) {
    return {
      ok: true,
      json: async () => ({
        config: {
          overrides: {
            endpoints: {
              custom: [
                {
                  name: 'second',
                  baseURL: 'https://scope-second.example.com',
                  apiKey: 'scope-secret-key',
                },
              ],
            },
          },
        },
      }),
    };
  }
  return {
    ok: true,
    json: async () => ({ config: { overrides: {} } }),
  };
});
const requireAnyCapabilityMock = vi.fn(async () => undefined);

vi.mock('./utils/api', () => ({
  apiFetch: (url: string) => apiFetchMock(url),
}));

vi.mock('./capabilities', () => ({
  requireAnyCapability: (...args: unknown[]) => requireAnyCapabilityMock(...args),
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    inputValidator: () => ({
      handler: (fn: (...args: unknown[]) => unknown) => fn,
    }),
    handler: (fn: (...args: unknown[]) => unknown) => fn,
  }),
  createServerOnlyFn: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

vi.mock('@tanstack/react-query', () => ({
  queryOptions: (opts: unknown) => opts,
}));

import {
  mergeIndexedArrayEntriesForScope,
  removeFieldProfileValueFn,
  tombstoneFieldProfileValueFn,
} from './scopes';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('mergeIndexedArrayEntriesForScope', () => {
  it('writes only the scope-owned keyed entry without pinning inherited base endpoints', async () => {
    const result = await mergeIndexedArrayEntriesForScope(PrincipalType.ROLE, 'ADMIN', [
      {
        fieldPath: 'endpoints.custom.1',
        value: { name: 'second', baseURL: 'https://edited.example.com', apiKey: '' },
      },
    ]);

    // Explicit empty-string credentials on an edited entry are preserved (not
    // reverted by retention). Base-only endpoints must not be pinned into scope.
    expect(result).toEqual([
      {
        fieldPath: 'endpoints.custom',
        value: [
          {
            name: 'second',
            baseURL: 'https://edited.example.com',
            apiKey: '',
          },
        ],
      },
    ]);
  });

  it('preserves omitted scope secrets when editing by effective index', async () => {
    const result = await mergeIndexedArrayEntriesForScope(PrincipalType.ROLE, 'ADMIN', [
      {
        fieldPath: 'endpoints.custom.1',
        value: { name: 'second', baseURL: 'https://edited.example.com' },
      },
    ]);

    expect(result).toEqual([
      {
        fieldPath: 'endpoints.custom',
        value: [
          {
            name: 'second',
            baseURL: 'https://edited.example.com',
            apiKey: 'scope-secret-key',
          },
        ],
      },
    ]);
  });

  it('rejects out-of-range indexes against the keyed effective array, not the raw scope overlay', async () => {
    await expect(
      mergeIndexedArrayEntriesForScope(PrincipalType.ROLE, 'ADMIN', [
        {
          fieldPath: 'endpoints.custom.3',
          value: { name: 'too-far', baseURL: 'https://x.example.com' },
        },
      ]),
    ).rejects.toThrow(/out of range for array of length 3/);
  });
});

describe('scope reset path validation', () => {
  const resetData = {
    principalType: PrincipalType.ROLE,
    principalId: 'ADMIN',
  };

  it('rejects terminal indexed removals before authorization and API access', async () => {
    const remove = removeFieldProfileValueFn as unknown as (args: {
      data: typeof resetData & { fieldPath: string };
    }) => Promise<{ success: true }>;

    await expect(
      remove({ data: { ...resetData, fieldPath: 'endpoints.custom.0' } }),
    ).rejects.toThrow(/Indexed array resets are not supported: endpoints\.custom\.0/);
    expect(requireAnyCapabilityMock).not.toHaveBeenCalled();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('rejects nested indexed tombstones before authorization and API access', async () => {
    const tombstone = tombstoneFieldProfileValueFn as unknown as (args: {
      data: typeof resetData & { fieldPath: string };
    }) => Promise<{ success: true }>;

    await expect(
      tombstone({ data: { ...resetData, fieldPath: 'endpoints.custom.0.baseURL' } }),
    ).rejects.toThrow(/Unsupported array path: endpoints\.custom\.0\.baseURL/);
    expect(requireAnyCapabilityMock).not.toHaveBeenCalled();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});
