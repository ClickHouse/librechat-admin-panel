import type { QueryClient } from '@tanstack/react-query';
import { baseConfigOptions, getBaseConfigFn } from '@/server';
import { installIfNewer } from './utils';

/** A direct read cannot join a stale in-flight fetch. Cancel before reading;
 * compare versions afterward because independent direct reads can still race. */
export async function refreshBaseConfig(queryClient: QueryClient) {
  await queryClient.cancelQueries({ queryKey: baseConfigOptions.queryKey });
  const fresh = await getBaseConfigFn();
  return installIfNewer(
    queryClient,
    [...baseConfigOptions.queryKey, fresh.effectiveTenantId],
    fresh,
    (value) => value.dbConfigVersion,
    (value) => value.effectiveTenantId,
  );
}
