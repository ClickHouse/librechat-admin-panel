export {
  SystemCapabilities,
  expandImplications,
  hasImpliedCapability,
  CAPABILITY_CATEGORIES,
  CapabilityImplications,
} from '@librechat/data-schemas/capabilities';

/**
 * Forward-compat shim: the LibreChat backend gates `/api/admin/audit-log` on
 * this capability string, but the published `@librechat/data-schemas` does
 * not yet export it via `SystemCapabilities`. Once the package version bumps,
 * delete this constant and reference `SystemCapabilities.READ_AUDIT_LOG`.
 */
export const READ_AUDIT_LOG_CAPABILITY = 'read:audit_log' as const;
