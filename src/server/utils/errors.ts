export const VERSION_CONFLICT_MESSAGE =
  'The configuration was changed by another admin. Reload and try again.';

/**
 * Thrown when the backend's atomic config endpoint rejects a mutation because
 * the caller's `expectedVersion` no longer matches the live document (HTTP 409).
 * Distinguishing this from a generic failure lets callers force a reload/rebase
 * of the edit session instead of leaving the admin retrying against a version
 * that can never succeed.
 */
export class ConfigVersionConflictError extends Error {
  readonly isVersionConflict = true;

  constructor(message: string = VERSION_CONFLICT_MESSAGE) {
    super(message);
    this.name = 'ConfigVersionConflictError';
  }
}

/**
 * Whether `error` represents a version conflict from the atomic config
 * endpoint. A server function's thrown error doesn't reliably keep its class
 * across the client/server RPC boundary, so this checks `name` first and
 * falls back to the stable message text, which always survives serialization.
 */
export function isVersionConflictError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === 'ConfigVersionConflictError' || error.message === VERSION_CONFLICT_MESSAGE;
}
