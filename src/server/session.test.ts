import { describe, it, expect } from 'vitest';
import { getSessionConfig } from './session';

describe('getSessionConfig', () => {
  it('revalidation interval is 60 seconds', () => {
    expect(getSessionConfig().revalidationInterval).toBe(60_000);
  });

  it('idle timeout defaults to 30 minutes', () => {
    expect(getSessionConfig().idleTimeout).toBe(30 * 60 * 1000);
  });
});
