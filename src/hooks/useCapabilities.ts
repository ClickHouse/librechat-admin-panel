import type * as t from '@/types';
import { useCapabilitiesContext } from '@/contexts';

export function useCapabilities(): t.CapabilitiesContextValue {
  return useCapabilitiesContext();
}
