import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.fn();
const snapshotMock = vi.fn();

vi.mock('./utils/api', () => ({
  apiFetch: (path: string, init?: RequestInit, expectedTenantId?: string) =>
    apiFetchMock(path, init, expectedTenantId),
}));

vi.mock('./revisions', () => ({
  readAuthenticatedBaseConfigSnapshot: (...args: unknown[]) => snapshotMock(...args),
}));

vi.mock('./capabilities', () => ({
  requireCapability: vi.fn(async () => undefined),
  requireAnyCapability: vi.fn(async () => undefined),
  requireAllSectionCapabilities: vi.fn(async () => undefined),
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    handler: (fn: (...args: unknown[]) => unknown) => fn,
    inputValidator: () => ({
      handler: (fn: (...args: unknown[]) => unknown) => fn,
    }),
  }),
  createServerOnlyFn: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

vi.mock('@tanstack/react-query', () => ({
  queryOptions: (opts: unknown) => opts,
}));

import {
  canonicalizeResetPaths,
  getBaseConfigFn,
  importBaseConfigFn,
  resetBaseConfigFieldFn,
  resetBaseConfigFn,
  saveBaseConfigFn,
} from './config';
import { buildSavePayload } from '@/components/configuration/utils';

function jsonResponse(status: number, body: object = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('getBaseConfigFn', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * `dbConfig` stands in for the `dbOverrides`/`dbConfigVersion` fields the
   * `/base` (non-`baseOnly`) response now carries alongside `config` — from
   * one backend read, not a separately-timed `/role/__base__` fetch. `null`
   * mirrors what the backend returns when no base document exists yet.
   */
  function mockTwoParallelFetches(
    dbConfig: { overrides?: object; configVersion: number } | null,
  ): void {
    apiFetchMock.mockImplementation((path: string) => {
      const url = String(path);
      if (url.includes('baseOnly=true')) {
        return Promise.resolve(jsonResponse(200, { config: {} }));
      }
      return Promise.resolve(
        jsonResponse(200, {
          config: {},
          dbOverrides: dbConfig?.overrides,
          dbConfigVersion: dbConfig?.configVersion ?? null,
          effectiveTenantId: 'tenant-a',
        }),
      );
    });
  }

  it('surfaces the base document configVersion the client must freeze for CAS', async () => {
    mockTwoParallelFetches({ overrides: { cache: true }, configVersion: 5 });

    const result = await getBaseConfigFn();
    expect(result.dbConfigVersion).toBe(5);
  });

  it('reports a null configVersion when the base document does not exist yet', async () => {
    mockTwoParallelFetches(null);

    const result = await getBaseConfigFn();
    expect(result.dbConfigVersion).toBeNull();
  });

  it('reads config, dbOverrides, and dbConfigVersion from a single /base response, never a separate document fetch', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      const url = String(path);
      if (url.includes('baseOnly=true')) {
        return Promise.resolve(jsonResponse(200, { config: {} }));
      }
      if (url.includes('/role/')) {
        // A regression here would mean a mutation racing between two
        // independently-timed reads could pair stale content with a fresh
        // CAS version (or vice versa) — see the /base handler's docstring.
        return Promise.reject(new Error('getBaseConfigFn must not fetch /role/__base__'));
      }
      return Promise.resolve(
        jsonResponse(200, {
          config: {},
          dbOverrides: { cache: true },
          dbConfigVersion: 5,
          effectiveTenantId: 'tenant-a',
        }),
      );
    });

    const result = await getBaseConfigFn();
    expect(result.dbConfigVersion).toBe(5);
    expect(result.dbOverrides).toEqual({ cache: true });
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails the page load when the base config fetch fails', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      const url = String(path);
      if (url.includes('baseOnly=true')) {
        return Promise.resolve(jsonResponse(200, { config: {} }));
      }
      return Promise.resolve(jsonResponse(500, { error: 'Internal Server Error' }));
    });

    await expect(getBaseConfigFn()).rejects.toThrow(/Failed to fetch base config: 500/);
  });

  it('fails the page load when the YAML baseline (baseOnly) fetch fails', async () => {
    apiFetchMock.mockImplementation((path: string) => {
      const url = String(path);
      if (url.includes('baseOnly=true')) {
        return Promise.resolve(jsonResponse(503, { error: 'Service Unavailable' }));
      }
      return Promise.resolve(
        jsonResponse(200, {
          config: {},
          dbConfigVersion: null,
          effectiveTenantId: 'tenant-a',
        }),
      );
    });

    await expect(getBaseConfigFn()).rejects.toThrow(/Failed to fetch YAML baseline config: 503/);
  });
});

describe('canonicalizeResetPaths', () => {
  it('deduplicates exact paths and keeps the highest ancestor', () => {
    expect(
      canonicalizeResetPaths(['registration', 'registration.enabled', 'registration.enabled']),
    ).toEqual(['registration']);
    expect(canonicalizeResetPaths(['cache', 'registration.enabled'])).toEqual([
      'cache',
      'registration.enabled',
    ]);
  });
});

describe('applyBaseConfigMutation atomic endpoint', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    snapshotMock.mockReset();
    snapshotMock.mockResolvedValue({
      overrides: { cache: false, registration: { enabled: true } },
      absent: false,
      configVersion: 5,
      tenantId: 'tenant-a',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('posts a remove/recreate draft as one replacement, retaining no-origin credential hints', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse(200, { config: { configVersion: 6 } }));
    const edits = {
      'mcpServers.remote': undefined,
      'mcpServers.remote.type': 'sse',
      'mcpServers.remote.url': 'https://new.example.com',
    };
    const { saves, resets } = buildSavePayload(
      new Set(Object.keys(edits)),
      edits,
      new Set(),
      new Set(),
    );
    await saveBaseConfigFn({
      data: {
        entries: saves,
        resetPaths: resets,
        expectedVersion: 5,
        expectedTenantId: 'tenant-a',
      },
    });
    expect(apiFetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(String(apiFetchMock.mock.calls[0][1]?.body))).toEqual({
      expectedVersion: 5,
      expectedTenantId: 'tenant-a',
      cause: 'save',
      priority: 0,
      entries: [
        {
          fieldPath: 'mcpServers.remote',
          value: {
            type: 'sse',
            url: 'https://new.example.com',
            headers: { __previousIdentity: null },
            oauth_headers: { __previousIdentity: null },
          },
        },
      ],
    });
  });

  it('sends expectedVersion, canonicalized resets, and entries in one atomic request', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse(200, { config: { configVersion: 6 } }));

    const save = saveBaseConfigFn as unknown as (args: {
      data: {
        entries: Array<{ fieldPath: string; value: unknown }>;
        resetPaths: string[];
        expectedVersion: number | null;
        expectedTenantId: string;
      };
    }) => Promise<{ success: true }>;

    await save({
      data: {
        entries: [{ fieldPath: 'cache', value: true }],
        resetPaths: ['registration', 'registration.enabled', 'registration'],
        expectedVersion: 5,
        expectedTenantId: 'tenant-a',
      },
    });

    expect(apiFetchMock).toHaveBeenCalledOnce();
    const [path, init, expectedTenantId] = apiFetchMock.mock.calls[0] as [
      string,
      RequestInit,
      string,
    ];
    expect(path).toContain('/atomic');
    expect(expectedTenantId).toBe('tenant-a');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      expectedVersion: 5,
      expectedTenantId: 'tenant-a',
      cause: 'save',
      resetPaths: ['registration'],
      entries: [{ fieldPath: 'cache', value: true }],
      priority: 0,
    });
  });

  it('fails closed on a version conflict without a compensating write', async () => {
    apiFetchMock.mockResolvedValue(
      jsonResponse(409, { error: 'Config version conflict', currentVersion: 7 }),
    );

    const save = saveBaseConfigFn as unknown as (args: {
      data: { entries: Array<{ fieldPath: string; value: unknown }> };
    }) => Promise<{ success: true }>;

    await expect(
      save({ data: { entries: [{ fieldPath: 'cache', value: true }] } }),
    ).rejects.toThrow(/changed by another admin/);
    expect(apiFetchMock).toHaveBeenCalledOnce();
  });

  it('forwards a null expectedVersion from the client unchanged when the frozen session started absent', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse(200, { config: { configVersion: 1 } }));

    const save = saveBaseConfigFn as unknown as (args: {
      data: { entries: Array<{ fieldPath: string; value: unknown }>; expectedVersion: null };
    }) => Promise<{ success: true }>;

    await save({ data: { entries: [{ fieldPath: 'cache', value: true }], expectedVersion: null } });
    expect(JSON.parse(String(apiFetchMock.mock.calls[0][1]?.body)).expectedVersion).toBeNull();
    // A non-indexed save never needs the current DB overrides, so this must
    // not silently re-derive expectedVersion from a fresh read.
    expect(snapshotMock).not.toHaveBeenCalled();
  });

  it('routes the stale field-reset endpoint through the atomic mutation', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse(200, { config: { configVersion: 6 } }));

    const resetField = resetBaseConfigFieldFn as unknown as (args: {
      data: { fieldPath: string; expectedVersion: number | null };
    }) => Promise<{ success: true }>;

    await resetField({ data: { fieldPath: 'cache', expectedVersion: 5 } });

    expect(JSON.parse(String(apiFetchMock.mock.calls[0][1]?.body))).toEqual({
      expectedVersion: 5,
      cause: 'save',
      resetPaths: ['cache'],
      priority: 0,
    });
  });

  it('merges indexed array edits onto YAML when snapshot.overrides omit the array', async () => {
    snapshotMock.mockResolvedValue({
      overrides: { cache: true },
      absent: false,
      configVersion: 9,
      tenantId: 'tenant-a',
    });
    apiFetchMock.mockImplementation((path: string) => {
      if (String(path).includes('baseOnly=true')) {
        return jsonResponse(200, {
          config: {
            endpoints: {
              custom: [
                { name: 'yaml-0', baseURL: 'https://yaml-0.example.com' },
                { name: 'yaml-1', baseURL: 'https://yaml-1.example.com' },
                { name: 'yaml-2', baseURL: 'https://yaml-2.example.com' },
              ],
            },
          },
        });
      }
      return jsonResponse(200, { config: { configVersion: 10 } });
    });

    const save = saveBaseConfigFn as unknown as (args: {
      data: {
        entries: Array<{ fieldPath: string; value: unknown }>;
        expectedVersion: number | null;
      };
    }) => Promise<{ success: true }>;

    await save({
      data: {
        entries: [
          {
            fieldPath: 'endpoints.custom.1',
            value: { name: 'edited', baseURL: 'https://edited.example.com' },
          },
        ],
        expectedVersion: 9,
      },
    });

    const yamlCall = apiFetchMock.mock.calls.find(([path]) =>
      String(path).includes('baseOnly=true'),
    );
    const atomicCall = apiFetchMock.mock.calls.find(([path]) => String(path).includes('/atomic'));
    expect(yamlCall).toBeDefined();
    expect(atomicCall).toBeDefined();
    // The array-merge baseline (snapshot.overrides) still comes from a fresh
    // read — only expectedVersion is the client-frozen value.
    expect(snapshotMock).toHaveBeenCalled();
    expect(JSON.parse(String(atomicCall?.[1]?.body))).toEqual({
      expectedVersion: 9,
      cause: 'save',
      entries: [
        {
          fieldPath: 'endpoints.custom',
          value: [
            { name: 'yaml-0', baseURL: 'https://yaml-0.example.com' },
            { name: 'edited', baseURL: 'https://edited.example.com' },
            { name: 'yaml-2', baseURL: 'https://yaml-2.example.com' },
          ],
        },
      ],
      priority: 0,
    });
  });

  it('rejects an indexed-array save when its fresh baseline belongs to another tenant at the same version', async () => {
    snapshotMock.mockResolvedValue({
      overrides: {
        endpoints: {
          custom: [{ name: 'tenant-b', baseURL: 'https://tenant-b.example.com' }],
        },
      },
      absent: false,
      configVersion: 9,
      effectiveTenantId: 'tenant-b',
    });
    apiFetchMock.mockImplementation((path: string) => {
      if (String(path).includes('baseOnly=true')) {
        return jsonResponse(200, { config: { endpoints: { custom: [] } } });
      }
      return jsonResponse(200, { config: { configVersion: 10 } });
    });

    const save = saveBaseConfigFn as unknown as (args: {
      data: {
        entries: Array<{ fieldPath: string; value: unknown }>;
        expectedVersion: number | null;
        expectedTenantId: string;
      };
    }) => Promise<{ success: true }>;

    await expect(
      save({
        data: {
          entries: [
            {
              fieldPath: 'endpoints.custom.0',
              value: { name: 'draft', baseURL: 'https://draft.example.com' },
            },
          ],
          expectedVersion: 9,
          expectedTenantId: 'tenant-a',
        },
      }),
    ).rejects.toThrow(/changed by another admin/);
    expect(apiFetchMock.mock.calls.some(([path]) => String(path).includes('/atomic'))).toBe(false);
  });

  it('merges indexed array edits onto keyed YAML and partial Mongo arrays', async () => {
    snapshotMock.mockResolvedValue({
      overrides: {
        endpoints: {
          custom: [
            { name: 'b', baseURL: 'https://mongo-b.example.com', apiKey: 'mongo-key' },
            { name: 'd', baseURL: 'https://d.example.com' },
          ],
        },
      },
      absent: false,
      configVersion: 9,
      tenantId: 'tenant-a',
    });
    apiFetchMock.mockImplementation((path: string) => {
      if (String(path).includes('baseOnly=true')) {
        return jsonResponse(200, {
          config: {
            endpoints: {
              custom: [
                { name: 'a', baseURL: 'https://a.example.com' },
                { name: 'b', baseURL: 'https://b.example.com' },
                { name: 'c', baseURL: 'https://c.example.com' },
              ],
            },
          },
        });
      }
      return jsonResponse(200, { config: { configVersion: 10 } });
    });

    const save = saveBaseConfigFn as unknown as (args: {
      data: {
        entries: Array<{ fieldPath: string; value: unknown }>;
        expectedVersion: number | null;
      };
    }) => Promise<{ success: true }>;

    await save({
      data: {
        entries: [
          {
            fieldPath: 'endpoints.custom.1',
            value: { name: 'b', baseURL: 'https://edited.example.com' },
          },
        ],
        expectedVersion: 9,
      },
    });

    const atomicCall = apiFetchMock.mock.calls.find(([path]) => String(path).includes('/atomic'));
    expect(atomicCall).toBeDefined();
    expect(JSON.parse(String(atomicCall?.[1]?.body))).toEqual({
      expectedVersion: 9,
      cause: 'save',
      entries: [
        {
          fieldPath: 'endpoints.custom',
          value: [
            { name: 'a', baseURL: 'https://a.example.com' },
            { name: 'b', baseURL: 'https://edited.example.com', apiKey: 'mongo-key' },
            { name: 'c', baseURL: 'https://c.example.com' },
            { name: 'd', baseURL: 'https://d.example.com' },
          ],
        },
      ],
      priority: 0,
    });
  });

  it('forwards protected-only saves to the atomic endpoint for authorization and CAS', async () => {
    apiFetchMock.mockResolvedValue(
      jsonResponse(200, { message: 'No actionable field entries provided' }),
    );

    const save = saveBaseConfigFn as unknown as (args: {
      data: {
        entries: Array<{ fieldPath: string; value: unknown }>;
        expectedVersion: number | null;
      };
    }) => Promise<{ success: true }>;

    await save({
      data: { entries: [{ fieldPath: 'interface.prompts', value: false }], expectedVersion: 5 },
    });

    expect(apiFetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(String(apiFetchMock.mock.calls[0][1]?.body))).toEqual({
      expectedVersion: 5,
      cause: 'save',
      entries: [{ fieldPath: 'interface.prompts', value: false }],
      priority: 0,
    });
  });

  it('rejects combined entries and resetPaths above the atomic limit', async () => {
    const save = saveBaseConfigFn as unknown as (args: {
      data: {
        entries: Array<{ fieldPath: string; value: unknown }>;
        resetPaths: string[];
      };
    }) => Promise<{ success: true }>;

    await expect(
      save({
        data: {
          entries: Array.from({ length: 51 }, (_, index) => ({
            fieldPath: `field${index}`,
            value: true,
          })),
          resetPaths: Array.from({ length: 50 }, (_, index) => `reset${index}`),
        },
      }),
    ).rejects.toThrow(/combined entries and resetPaths exceed maximum of 100/);
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('rejects invalid indexed array element values before merging', async () => {
    const save = saveBaseConfigFn as unknown as (args: {
      data: { entries: Array<{ fieldPath: string; value: unknown }> };
    }) => Promise<{ success: true }>;

    await expect(
      save({
        data: {
          entries: [{ fieldPath: 'mcpServers.filesystem.args.1', value: {} }],
        },
      }),
    ).rejects.toThrow(/Validation failed/);
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(snapshotMock).not.toHaveBeenCalled();
  });

  it('rejects oversized array indexes before sending an atomic request', async () => {
    const save = saveBaseConfigFn as unknown as (args: {
      data: { entries: Array<{ fieldPath: string; value: unknown }> };
    }) => Promise<{ success: true }>;

    await expect(
      save({
        data: {
          entries: [
            {
              fieldPath: 'endpoints.custom.10001',
              value: { name: 'too-far', baseURL: 'https://example.com' },
            },
          ],
        },
      }),
    ).rejects.toThrow(/Invalid array index in path: endpoints\.custom\.10001/);
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(snapshotMock).not.toHaveBeenCalled();
  });

  it('rejects negative array indexes before sending an atomic request', async () => {
    const save = saveBaseConfigFn as unknown as (args: {
      data: { entries: Array<{ fieldPath: string; value: unknown }> };
    }) => Promise<{ success: true }>;

    await expect(
      save({
        data: {
          entries: [
            {
              fieldPath: 'endpoints.custom.-1',
              value: { name: 'neg', baseURL: 'https://example.com' },
            },
          ],
        },
      }),
    ).rejects.toThrow(/Invalid array index in path: endpoints\.custom\.-1/);
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(snapshotMock).not.toHaveBeenCalled();
  });

  it('rejects noncanonical and nested array entry paths before atomic POST', async () => {
    const save = saveBaseConfigFn as unknown as (args: {
      data: { entries: Array<{ fieldPath: string; value: unknown }> };
    }) => Promise<{ success: true }>;

    await expect(
      save({
        data: {
          entries: [{ fieldPath: 'endpoints.custom.+1', value: { name: 'plus' } }],
        },
      }),
    ).rejects.toThrow(/Invalid array index in path: endpoints\.custom\.\+1/);
    expect(apiFetchMock).not.toHaveBeenCalled();

    await expect(
      save({
        data: {
          entries: [{ fieldPath: 'endpoints.custom.foo', value: { name: 'named' } }],
        },
      }),
    ).rejects.toThrow(/Invalid array index in path: endpoints\.custom\.foo/);
    expect(apiFetchMock).not.toHaveBeenCalled();

    await expect(
      save({
        data: {
          entries: [{ fieldPath: 'endpoints.custom.0.baseURL', value: 'https://example.com' }],
        },
      }),
    ).rejects.toThrow(/Unsupported array path: endpoints\.custom\.0\.baseURL/);
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(snapshotMock).not.toHaveBeenCalled();
  });

  it('rejects indexed array reset paths before sending an atomic request', async () => {
    const save = saveBaseConfigFn as unknown as (args: {
      data: { resetPaths: string[] };
    }) => Promise<{ success: true }>;

    await expect(
      save({
        data: { resetPaths: ['endpoints.custom.10001'] },
      }),
    ).rejects.toThrow(/Invalid array index in path: endpoints\.custom\.10001/);
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(snapshotMock).not.toHaveBeenCalled();

    await expect(
      save({
        data: { resetPaths: ['endpoints.custom.0.baseURL'] },
      }),
    ).rejects.toThrow(/Unsupported array path: endpoints\.custom\.0\.baseURL/);
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('rejects terminal indexed array resets that would no-op on the backend', async () => {
    const save = saveBaseConfigFn as unknown as (args: {
      data: { resetPaths: string[] };
    }) => Promise<{ success: true }>;

    await expect(
      save({
        data: { resetPaths: ['endpoints.custom.0'] },
      }),
    ).rejects.toThrow(/Indexed array resets are not supported: endpoints\.custom\.0/);
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(snapshotMock).not.toHaveBeenCalled();
  });

  it('rejects ambiguous array|record union paths before atomic POST', async () => {
    const save = saveBaseConfigFn as unknown as (args: {
      data: { entries: Array<{ fieldPath: string; value: unknown }> };
    }) => Promise<{ success: true }>;

    await expect(
      save({
        data: {
          entries: [{ fieldPath: 'endpoints.anthropic.vertex.models.0', value: 'claude' }],
        },
      }),
    ).rejects.toThrow(/Unsupported array path: endpoints\.anthropic\.vertex\.models\.0/);
    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(snapshotMock).not.toHaveBeenCalled();
  });

  it('merges union-wrapped array index edits instead of posting a dotted path', async () => {
    snapshotMock.mockResolvedValue({
      overrides: {},
      absent: false,
      configVersion: 9,
      tenantId: 'tenant-a',
    });
    apiFetchMock.mockImplementation((path: string) => {
      if (String(path).includes('baseOnly=true')) {
        return jsonResponse(200, {
          config: {
            interface: {
              termsOfService: {
                modalContent: ['line-0', 'line-1', 'line-2'],
              },
            },
          },
        });
      }
      return jsonResponse(200, { config: { configVersion: 10 } });
    });

    const save = saveBaseConfigFn as unknown as (args: {
      data: {
        entries: Array<{ fieldPath: string; value: unknown }>;
        expectedVersion: number | null;
      };
    }) => Promise<{ success: true }>;

    await save({
      data: {
        entries: [{ fieldPath: 'interface.termsOfService.modalContent.1', value: 'edited' }],
        expectedVersion: 9,
      },
    });

    const atomicCall = apiFetchMock.mock.calls.find(([path]) => String(path).includes('/atomic'));
    expect(atomicCall).toBeDefined();
    expect(JSON.parse(String(atomicCall?.[1]?.body))).toEqual({
      expectedVersion: 9,
      cause: 'save',
      entries: [
        {
          fieldPath: 'interface.termsOfService.modalContent',
          value: ['line-0', 'edited', 'line-2'],
        },
      ],
      priority: 0,
    });
  });
});

describe('importBaseConfigFn', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    snapshotMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('forwards the client-frozen expectedVersion instead of re-deriving it from a fresh snapshot', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse(200, { config: { configVersion: 6 } }));

    const importFn = importBaseConfigFn as unknown as (args: {
      data: { config: Record<string, unknown>; expectedVersion: number | null };
    }) => Promise<{ success: true }>;

    await importFn({
      data: { config: { cache: true }, expectedVersion: 5 },
    });

    expect(apiFetchMock).toHaveBeenCalledOnce();
    const [path, init] = apiFetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toContain('/atomic');
    expect(JSON.parse(String(init.body))).toEqual({
      expectedVersion: 5,
      cause: 'import',
      overrides: { cache: true },
      priority: 0,
    });
    // A stale-admin regression: if this self-derived expectedVersion from a
    // fresh read instead of the client-frozen value, it would always match
    // the live document and silently defeat conflict detection.
    expect(snapshotMock).not.toHaveBeenCalled();
  });

  it('forwards a null expectedVersion when the frozen session started absent', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse(200, { config: { configVersion: 1 } }));

    const importFn = importBaseConfigFn as unknown as (args: {
      data: { config: Record<string, unknown>; expectedVersion: number | null };
    }) => Promise<{ success: true }>;

    await importFn({ data: { config: { cache: true }, expectedVersion: null } });

    expect(JSON.parse(String(apiFetchMock.mock.calls[0][1]?.body)).expectedVersion).toBeNull();
  });

  it('fails closed on a version conflict without a compensating write', async () => {
    apiFetchMock.mockResolvedValue(
      jsonResponse(409, { error: 'Config version conflict', currentVersion: 7 }),
    );

    const importFn = importBaseConfigFn as unknown as (args: {
      data: { config: Record<string, unknown>; expectedVersion: number | null };
    }) => Promise<{ success: true }>;

    await expect(
      importFn({ data: { config: { cache: true }, expectedVersion: 5 } }),
    ).rejects.toThrow(/changed by another admin/);
    expect(apiFetchMock).toHaveBeenCalledOnce();
  });
});

describe('resetBaseConfigFn', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    snapshotMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('forwards the client-frozen expectedVersion instead of re-deriving it from a fresh snapshot', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse(200, { config: { configVersion: 6 } }));

    const resetFn = resetBaseConfigFn as unknown as (args: {
      data: { expectedVersion: number | null };
    }) => Promise<{ success: true }>;

    await resetFn({ data: { expectedVersion: 5 } });

    expect(apiFetchMock).toHaveBeenCalledOnce();
    const [path, init] = apiFetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toContain('/atomic');
    expect(JSON.parse(String(init.body))).toEqual({
      expectedVersion: 5,
      cause: 'reset',
      deleteDocument: true,
    });
    // A stale-admin regression: if this self-derived expectedVersion from a
    // fresh read instead of the client-frozen value, it would always match
    // the live document and silently defeat conflict detection.
    expect(snapshotMock).not.toHaveBeenCalled();
  });

  it('fails closed on a version conflict without a compensating write', async () => {
    apiFetchMock.mockResolvedValue(
      jsonResponse(409, { error: 'Config version conflict', currentVersion: 7 }),
    );

    const resetFn = resetBaseConfigFn as unknown as (args: {
      data: { expectedVersion: number | null };
    }) => Promise<{ success: true }>;

    await expect(resetFn({ data: { expectedVersion: 5 } })).rejects.toThrow(
      /changed by another admin/,
    );
    expect(apiFetchMock).toHaveBeenCalledOnce();
  });
});
