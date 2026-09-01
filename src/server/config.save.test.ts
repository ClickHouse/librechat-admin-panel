import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.fn();
const snapshotMock = vi.fn();

vi.mock('./utils/api', () => ({
  apiFetch: (path: string, init?: RequestInit) => apiFetchMock(path, init),
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

import { canonicalizeResetPaths, resetBaseConfigFieldFn, saveBaseConfigFn } from './config';

function jsonResponse(status: number, body: object = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

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

  it('sends expectedVersion, canonicalized resets, and entries in one atomic request', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse(200, { config: { configVersion: 6 } }));

    const save = saveBaseConfigFn as unknown as (args: {
      data: {
        entries: Array<{ fieldPath: string; value: unknown }>;
        resetPaths: string[];
      };
    }) => Promise<{ success: true }>;

    await save({
      data: {
        entries: [{ fieldPath: 'cache', value: true }],
        resetPaths: ['registration', 'registration.enabled', 'registration'],
      },
    });

    expect(apiFetchMock).toHaveBeenCalledOnce();
    const [path, init] = apiFetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toContain('/atomic');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      expectedVersion: 5,
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

  it('sends null expectedVersion when the base document is absent', async () => {
    snapshotMock.mockResolvedValue({
      overrides: {},
      absent: true,
      configVersion: null,
      tenantId: '',
    });
    apiFetchMock.mockResolvedValue(jsonResponse(200, { config: { configVersion: 1 } }));

    const save = saveBaseConfigFn as unknown as (args: {
      data: { entries: Array<{ fieldPath: string; value: unknown }> };
    }) => Promise<{ success: true }>;

    await save({ data: { entries: [{ fieldPath: 'cache', value: true }] } });
    expect(JSON.parse(String(apiFetchMock.mock.calls[0][1]?.body)).expectedVersion).toBeNull();
  });

  it('routes the stale field-reset endpoint through the atomic mutation', async () => {
    apiFetchMock.mockResolvedValue(jsonResponse(200, { config: { configVersion: 6 } }));

    const resetField = resetBaseConfigFieldFn as unknown as (args: {
      data: { fieldPath: string };
    }) => Promise<{ success: true }>;

    await resetField({ data: { fieldPath: 'cache' } });

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
      data: { entries: Array<{ fieldPath: string; value: unknown }> };
    }) => Promise<{ success: true }>;

    await save({
      data: {
        entries: [
          {
            fieldPath: 'endpoints.custom.1',
            value: { name: 'edited', baseURL: 'https://edited.example.com' },
          },
        ],
      },
    });

    const yamlCall = apiFetchMock.mock.calls.find(([path]) =>
      String(path).includes('baseOnly=true'),
    );
    const atomicCall = apiFetchMock.mock.calls.find(([path]) => String(path).includes('/atomic'));
    expect(yamlCall).toBeDefined();
    expect(atomicCall).toBeDefined();
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
      data: { entries: Array<{ fieldPath: string; value: unknown }> };
    }) => Promise<{ success: true }>;

    await save({
      data: {
        entries: [
          {
            fieldPath: 'endpoints.custom.1',
            value: { name: 'b', baseURL: 'https://edited.example.com' },
          },
        ],
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
      data: { entries: Array<{ fieldPath: string; value: unknown }> };
    }) => Promise<{ success: true }>;

    await save({
      data: { entries: [{ fieldPath: 'interface.prompts', value: false }] },
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
      data: { entries: Array<{ fieldPath: string; value: unknown }> };
    }) => Promise<{ success: true }>;

    await save({
      data: {
        entries: [{ fieldPath: 'interface.termsOfService.modalContent.1', value: 'edited' }],
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
