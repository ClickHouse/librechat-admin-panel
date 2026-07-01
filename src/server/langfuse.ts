import { z } from 'zod';
import { createServerFn } from '@tanstack/react-start';
import { SystemCapabilities } from '@librechat/data-schemas/capabilities';
import { requireCapability } from './capabilities';

/**
 * Validate a tenant Langfuse connection by calling the Langfuse public projects
 * endpoint with the supplied credentials. Admin-gated because it makes an
 * outbound request to a caller-supplied host.
 */
export const testLangfuseConnectionFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      baseUrl: z.string(),
      publicKey: z.string(),
      secretKey: z.string(),
    }),
  )
  .handler(async ({ data }): Promise<{ success: boolean; message?: string }> => {
    await requireCapability(SystemCapabilities.MANAGE_CONFIGS);

    const baseUrl = data.baseUrl.trim().replace(/\/+$/, '');
    if (!baseUrl || !data.publicKey || !data.secretKey) {
      return { success: false, message: 'Base URL, public key, and secret key are required' };
    }

    let url: URL;
    try {
      url = new URL(`${baseUrl}/api/public/projects`);
    } catch {
      return { success: false, message: 'Base URL is not a valid URL' };
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return { success: false, message: 'Base URL must use http or https' };
    }

    try {
      const auth = Buffer.from(`${data.publicKey}:${data.secretKey}`).toString('base64');
      const response = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
      return response.ok
        ? { success: true }
        : { success: false, message: `Langfuse responded with status ${response.status}` };
    } catch {
      return { success: false, message: 'Could not reach the Langfuse host' };
    }
  });
