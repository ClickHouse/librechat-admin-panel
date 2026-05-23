/** Changing `type` breaks the MCPOptionsSchema Zod union and produces inspectionFailed stubs that cannot connect. */
export const YAML_LOCKED_FIELDS = new Set(['type']);

/** Inspector-populated fields; admin overrides for these are silently ignored. */
export const INSPECTOR_DERIVED = new Set([
  'tools',
  'capabilities',
  'initDuration',
  'inspectionFailed',
  'updatedAt',
  'dbId',
  'source',
]);
