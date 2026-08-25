import { describe, it, expect } from 'vitest';
import { isSafeInternalPath, sanitizeInternalRedirect } from './redirect';

describe('isSafeInternalPath', () => {
  it('accepts same-origin absolute paths', () => {
    for (const ok of ['/', '/users', '/access?tab=roles', '/a/b/c']) {
      expect(isSafeInternalPath(ok)).toBe(true);
    }
  });

  it('rejects open-redirect and non-path payloads', () => {
    for (const bad of [
      '//evil.com',
      '/\\evil.com',
      'https://evil.com',
      'evil.com',
      '',
      undefined,
      null,
    ]) {
      expect(isSafeInternalPath(bad)).toBe(false);
    }
  });
});

describe('sanitizeInternalRedirect', () => {
  it('passes through a safe path unchanged', () => {
    expect(sanitizeInternalRedirect('/users')).toBe('/users');
  });

  it('falls back to "/" for unsafe or missing targets', () => {
    for (const bad of [
      '//evil.com',
      '/\\evil.com',
      'https://evil.com',
      'evil.com',
      '',
      undefined,
      null,
    ]) {
      expect(sanitizeInternalRedirect(bad)).toBe('/');
    }
  });
});
