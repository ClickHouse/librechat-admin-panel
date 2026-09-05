import { describe, it, expect } from 'vitest';
import {
  ConfigVersionConflictError,
  VERSION_CONFLICT_MESSAGE,
  isVersionConflictError,
} from './errors';

describe('isVersionConflictError', () => {
  it('recognizes a real ConfigVersionConflictError instance', () => {
    expect(isVersionConflictError(new ConfigVersionConflictError())).toBe(true);
  });

  it('recognizes a plain Error carrying the same name, as if reconstructed across an RPC boundary', () => {
    // TanStack Start server-function errors don't reliably survive the
    // client/server boundary as their original class — only plain
    // properties like name/message typically make it across.
    const reconstructed = new Error(VERSION_CONFLICT_MESSAGE);
    reconstructed.name = 'ConfigVersionConflictError';
    expect(isVersionConflictError(reconstructed)).toBe(true);
  });

  it('recognizes a plain Error carrying only the stable message text', () => {
    expect(isVersionConflictError(new Error(VERSION_CONFLICT_MESSAGE))).toBe(true);
  });

  it('rejects an unrelated error', () => {
    expect(isVersionConflictError(new Error('Something else went wrong'))).toBe(false);
  });

  it('rejects non-Error values', () => {
    expect(isVersionConflictError('a string')).toBe(false);
    expect(isVersionConflictError(null)).toBe(false);
    expect(isVersionConflictError(undefined)).toBe(false);
  });
});
