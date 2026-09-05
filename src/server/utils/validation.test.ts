import { describe, expect, it } from 'vitest';
import {
  MAX_FIELD_PATH_LENGTH,
  MAX_FIELD_PATH_SEGMENTS,
  fieldPathPolicyError,
  safeFieldPath,
} from './validation';

describe('fieldPathPolicyError', () => {
  it('accepts ordinary dotted paths', () => {
    expect(fieldPathPolicyError('endpoints.custom.0.apiKey')).toBeNull();
  });

  it('rejects empty paths', () => {
    expect(fieldPathPolicyError('')).toBe('field path must not be empty');
  });

  it('rejects NUL bytes before submitting a MongoDB field path', () => {
    expect(fieldPathPolicyError('cache.\0value')).toBe('field path contains NUL byte');
    expect(() => safeFieldPath.parse('cache.\0value')).toThrow(/NUL byte/);
  });

  it('rejects oversized paths', () => {
    expect(fieldPathPolicyError('a'.repeat(MAX_FIELD_PATH_LENGTH + 1))).toBe(
      `field path exceeds maximum length of ${MAX_FIELD_PATH_LENGTH}`,
    );
  });

  it('rejects paths deeper than the segment limit', () => {
    const deep = Array.from({ length: MAX_FIELD_PATH_SEGMENTS + 1 }, (_, i) => `s${i}`).join('.');
    expect(fieldPathPolicyError(deep)).toBe(
      `field path exceeds maximum depth of ${MAX_FIELD_PATH_SEGMENTS} segments`,
    );
  });

  it('rejects malformed dot structure', () => {
    expect(fieldPathPolicyError('.leading')).toBe('field path has invalid structure');
    expect(fieldPathPolicyError('trailing.')).toBe('field path has invalid structure');
    expect(fieldPathPolicyError('a..b')).toBe('field path has invalid structure');
  });

  it('rejects prototype-pollution segments', () => {
    expect(fieldPathPolicyError('__proto__.polluted')).toBe(
      'field path contains forbidden segment',
    );
    expect(fieldPathPolicyError('a.constructor.b')).toBe('field path contains forbidden segment');
    expect(fieldPathPolicyError('a.__hidden__.b')).toBe('field path contains forbidden segment');
    expect(fieldPathPolicyError('a.__hidden-key.b')).toBe('field path contains forbidden segment');
    expect(fieldPathPolicyError('a.__på.b')).toBe('field path contains forbidden segment');
  });
});

describe('safeFieldPath', () => {
  it('parses valid paths', () => {
    expect(safeFieldPath.parse('cache')).toBe('cache');
  });

  it('rejects paths that violate the shared policy', () => {
    expect(() => safeFieldPath.parse('a..b')).toThrow(/invalid structure/);
    expect(() => safeFieldPath.parse('a'.repeat(MAX_FIELD_PATH_LENGTH + 1))).toThrow(
      /maximum length/,
    );
  });
});
