import { z } from 'zod';
import { createServerFn } from '@tanstack/react-start';
import { requireAllSectionCapabilities } from './capabilities';
import { ConfigVersionConflictError } from './utils/errors';
import { apiFetch, extractApiError } from './utils/api';

export interface LangfuseDestinationOption {
  key: string;
  baseUrl: string;
}

export interface LangfuseConnectionStatus {
  configured: boolean;
  enabled: boolean;
  configActive?: boolean;
  destinations: LangfuseDestinationOption[];
  destination?: string;
  publicKey?: string;
  secretKeyPreview?: string;
  displaySecretKey?: string;
  updatedAt?: string;
  configVersion: number | null;
  effectiveTenantId: string;
}

export interface LangfuseConnectionTestResponse {
  success: boolean;
  message?: string;
}

export const LANGFUSE_CONNECTION_QUERY_KEY = ['adminLangfuseConnection'] as const;

const connectionInputSchema = z.object({
  enabled: z.boolean(),
  destination: z.string(),
  publicKey: z.string(),
  secretKey: z.string().optional(),
  expectedVersion: z.number().nullable(),
  expectedTenantId: z.string(),
});

const tenantInputSchema = connectionInputSchema.pick({ expectedTenantId: true });

const connectionTestInputSchema = connectionInputSchema.omit({
  enabled: true,
  expectedVersion: true,
});

async function readConnectionStatus(response: Response): Promise<LangfuseConnectionStatus> {
  const payload = (await response.json()) as Partial<LangfuseConnectionStatus>;
  if (typeof payload.effectiveTenantId !== 'string') {
    throw new Error('Langfuse connection response is missing its effective tenant');
  }
  return payload as LangfuseConnectionStatus;
}

/**
 * Proxy the dedicated LibreChat Langfuse connection API. LibreChat owns the
 * destination allowlist, encrypted-secret handling, and credential checks.
 */
export const getLangfuseConnectionFn = createServerFn({ method: 'GET' })
  .inputValidator(tenantInputSchema)
  .handler(async ({ data }): Promise<LangfuseConnectionStatus> => {
    await requireAllSectionCapabilities(['langfuse']);
    const response = await apiFetch(
      '/api/admin/langfuse/connection',
      undefined,
      data.expectedTenantId,
    );
    if (!response.ok) {
      return extractApiError(response, 'Failed to read Langfuse connection');
    }
    return readConnectionStatus(response);
  });

export const updateLangfuseConnectionFn = createServerFn({ method: 'POST' })
  .inputValidator(connectionInputSchema)
  .handler(async ({ data }): Promise<LangfuseConnectionStatus> => {
    await requireAllSectionCapabilities(['langfuse']);
    const response = await apiFetch(
      '/api/admin/langfuse/connection',
      {
        method: 'PUT',
        body: JSON.stringify(data),
      },
      data.expectedTenantId,
    );
    if (response.status === 409) {
      throw new ConfigVersionConflictError();
    }
    if (!response.ok) {
      return extractApiError(response, 'Failed to update Langfuse connection');
    }
    return readConnectionStatus(response);
  });

export const testLangfuseConnectionFn = createServerFn({ method: 'POST' })
  .inputValidator(connectionTestInputSchema)
  .handler(async ({ data }): Promise<LangfuseConnectionTestResponse> => {
    await requireAllSectionCapabilities(['langfuse']);
    const response = await apiFetch(
      '/api/admin/langfuse/connection/test',
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
      data.expectedTenantId,
    );
    if (!response.ok) {
      return extractApiError(response, 'Failed to verify Langfuse connection');
    }
    return (await response.json()) as LangfuseConnectionTestResponse;
  });
