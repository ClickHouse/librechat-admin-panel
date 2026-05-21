/**
 * Static metadata for MCP server field handling.
 *
 * IMPORTANT: These sets MUST be updated when LibreChat adds new MCP fields.
 * The long-term plan is to encode this information directly in the Zod schema
 * as field-level tags (for example, `meta({ readonly: true })` or
 * `meta({ runtimeOnly: true })`) so the renderer can read it from the schema
 * tree instead of duplicating field-key knowledge. Tracked as future work.
 */

/**
 * Fields on YAML-defined MCP servers that the admin panel cannot edit because
 * mutating them is structurally unsafe under the deployment model.
 *
 * Multi-tenant LibreChat uses YAML for global defaults shared across all
 * tenants; the admin panel is the per-tenant customization surface, so most
 * fields (url, command, args, env, headers, apiKey, oauth) are legitimately
 * tenant-overrideable. Only `type` is locked because changing the transport
 * selector breaks the Zod union (MCPOptionsSchema) and produces
 * inspectionFailed stubs that cannot connect.
 *
 * Server name is locked separately via the hidden onRename affordance, not
 * through this set, because a name change creates a duplicate map key rather
 * than a true rename.
 */
export const YAML_LOCKED_FIELDS = new Set(['type']);

/**
 * Fields populated by the MCP inspector at runtime. Admin overrides for these
 * are silently ignored by the inspector, so we hide them from the editor
 * entirely (for both YAML and config-tier servers).
 */
export const INSPECTOR_DERIVED = new Set([
  'tools',
  'capabilities',
  'initDuration',
  'inspectionFailed',
  'updatedAt',
  'dbId',
  'source',
]);
