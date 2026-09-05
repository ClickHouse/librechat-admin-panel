import { useQuery } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type * as t from '@/types';
import { getTenantCapabilitiesFn, tenantQueryKeys } from '@/server';
import { hasImpliedCapability } from '@/constants';

const GRANTS_UNAVAILABLE_PATTERN = /\b(404|503)\b|endpoint not found|fetch failed/i;
const AUTH_DENIED_PATTERN =
  /\b(401|403)\b|forbidden|unauthorized|authentication required|no admin session token/i;

const CapabilitiesContext = createContext<t.CapabilitiesContextValue | null>(null);

export function CapabilitiesProvider({
  user,
  navigationKey,
  children,
}: t.CapabilitiesProviderProps) {
  const [tenantKey, setTenantKey] = useState(user.tenantId ?? '');
  const previousNavigationKey = useRef(navigationKey);

  const query = useQuery({
    queryKey: tenantQueryKeys.effectiveCapabilities(tenantKey, user.id),
    queryFn: async () => {
      try {
        const response = await getTenantCapabilitiesFn({ data: { expectedTenantId: tenantKey } });
        if (response.tenantChanged) {
          return response;
        }
        return {
          tenantChanged: false as const,
          available: true,
          capabilities: response.capabilities,
          effectiveTenantId: response.effectiveTenantId,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (GRANTS_UNAVAILABLE_PATTERN.test(message)) {
          return {
            tenantChanged: false as const,
            available: false,
            capabilities: [] as string[],
            effectiveTenantId: tenantKey,
          };
        }
        if (AUTH_DENIED_PATTERN.test(message)) {
          return {
            tenantChanged: false as const,
            available: true,
            capabilities: [] as string[],
            effectiveTenantId: tenantKey,
          };
        }
        throw error;
      }
    },
    staleTime: (cachedQuery) => (cachedQuery.state.data?.tenantChanged ? 0 : 30_000),
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    retry: false,
  });

  const { refetch } = query;
  useEffect(() => {
    if (previousNavigationKey.current === navigationKey) return;
    previousNavigationKey.current = navigationKey;
    void refetch();
  }, [navigationKey, refetch]);

  const effectiveTenantId = query.data?.tenantChanged
    ? query.data.currentTenantId
    : (query.data?.effectiveTenantId ?? tenantKey);
  useEffect(() => {
    if (!query.data) return;
    const nextTenantId = query.data.tenantChanged
      ? query.data.currentTenantId
      : query.data.effectiveTenantId;
    if (nextTenantId === tenantKey) return;
    setTenantKey(nextTenantId);
  }, [query.data, tenantKey]);

  const grantsAvailable = query.data && !query.data.tenantChanged ? query.data.available : false;
  const capabilities = query.data && !query.data.tenantChanged ? query.data.capabilities : [];
  const hasCapability = useCallback(
    (capability: string) => grantsAvailable && hasImpliedCapability(capabilities, capability),
    [capabilities, grantsAvailable],
  );
  const value = useMemo<t.CapabilitiesContextValue>(
    () => ({
      capabilities,
      effectiveTenantId,
      hasCapability,
      isLoading: query.isLoading,
      isError: query.isError,
    }),
    [capabilities, effectiveTenantId, hasCapability, query.isError, query.isLoading],
  );

  return <CapabilitiesContext.Provider value={value}>{children}</CapabilitiesContext.Provider>;
}

export function useCapabilitiesContext(): t.CapabilitiesContextValue {
  const context = useContext(CapabilitiesContext);
  if (!context) throw new Error('useCapabilities must be used within CapabilitiesProvider');
  return context;
}
