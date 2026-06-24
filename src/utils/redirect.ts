/**
 * Accept only same-origin absolute paths so a stored post-login redirect can't
 * be abused as an open redirect. Rejects protocol-relative (`//host`) and
 * backslash (`/\host`) forms that browsers may normalize to another origin.
 */
export function isSafeInternalPath(target: string | undefined | null): target is string {
  if (!target || target[0] !== '/') return false;
  return target[1] !== '/' && target[1] !== '\\';
}

/** Normalize an untrusted redirect target to a safe in-app path, defaulting to "/". */
export function sanitizeInternalRedirect(target: string | undefined | null): string {
  return isSafeInternalPath(target) ? target : '/';
}
