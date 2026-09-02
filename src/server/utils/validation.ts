import { z } from 'zod';

/** Mirrors LibreChat `MAX_FIELD_PATH_LENGTH` in data-schemas config methods. */
export const MAX_FIELD_PATH_LENGTH = 512;
/** Mirrors LibreChat `MAX_FIELD_PATH_SEGMENTS` in data-schemas config methods. */
export const MAX_FIELD_PATH_SEGMENTS = 32;

const UNSAFE_FIELD_PATH_SEGMENTS = /(?:^|\.)(__[^.]*|constructor|prototype)(?:\.|$)/;

export function fieldPathPolicyError(path: string): string | null {
  if (path.length === 0) {
    return 'field path must not be empty';
  }
  if (path.includes('\0')) {
    return 'field path contains NUL byte';
  }
  if (path.length > MAX_FIELD_PATH_LENGTH) {
    return `field path exceeds maximum length of ${MAX_FIELD_PATH_LENGTH}`;
  }
  let segmentCount = 1;
  for (let i = 0; i < path.length; i += 1) {
    if (path[i] === '.') {
      segmentCount += 1;
      if (segmentCount > MAX_FIELD_PATH_SEGMENTS) {
        return `field path exceeds maximum depth of ${MAX_FIELD_PATH_SEGMENTS} segments`;
      }
    }
  }
  if (path.startsWith('.') || path.endsWith('.') || path.includes('..')) {
    return 'field path has invalid structure';
  }
  if (UNSAFE_FIELD_PATH_SEGMENTS.test(path)) {
    return 'field path contains forbidden segment';
  }
  return null;
}

export const safeFieldPath = z.string().superRefine((path, ctx) => {
  const error = fieldPathPolicyError(path);
  if (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
  }
});
