import { describe, it, expect } from 'vitest';
import {
  isProbeRequest,
  createFloodGuard,
  formatLoggedPath,
  createMemoryWatermark,
  parseMemoryThresholdsMb,
} from './logging';

const MIB = 1024 * 1024;

describe('isProbeRequest', () => {
  it.each([
    ['kube-probe/1.29', true],
    ['kube-probe/1.31+', true],
    ['Mozilla/5.0 (Macintosh)', false],
    ['curl/8.7.1', false],
    ['', false],
    [null, false],
  ])('user-agent %s -> %s', (userAgent, expected) => {
    expect(isProbeRequest(userAgent)).toBe(expected);
  });
});

describe('formatLoggedPath', () => {
  it('passes short paths through unchanged', () => {
    expect(formatLoggedPath('/auth/openid/callback')).toBe('/auth/openid/callback');
  });

  it('truncates paths beyond 200 characters', () => {
    const long = `/${'a'.repeat(500)}`;
    const formatted = formatLoggedPath(long);
    expect(formatted).toBe(`${long.slice(0, 200)}...(truncated)`);
  });

  it('keeps a path of exactly 200 characters intact', () => {
    const exact = `/${'a'.repeat(199)}`;
    expect(formatLoggedPath(exact)).toBe(exact);
  });
});

describe('createFloodGuard', () => {
  it('admits requests up to the cap within one window', () => {
    const guard = createFloodGuard(3, 10_000);
    expect(guard.admit(1_000).admitted).toBe(true);
    expect(guard.admit(2_000).admitted).toBe(true);
    expect(guard.admit(3_000).admitted).toBe(true);
    expect(guard.admit(4_000).admitted).toBe(false);
    expect(guard.admit(5_000).admitted).toBe(false);
  });

  it('reports the suppressed count once when a new window opens', () => {
    const guard = createFloodGuard(2, 10_000);
    guard.admit(1_000);
    guard.admit(2_000);
    guard.admit(3_000);
    guard.admit(4_000);
    const next = guard.admit(12_000);
    expect(next.admitted).toBe(true);
    expect(next.suppressedInPriorWindow).toBe(2);
    expect(guard.admit(13_000).suppressedInPriorWindow).toBe(0);
  });

  it('resets the admission budget each window', () => {
    const guard = createFloodGuard(1, 10_000);
    expect(guard.admit(0).admitted).toBe(true);
    expect(guard.admit(1).admitted).toBe(false);
    expect(guard.admit(10_000).admitted).toBe(true);
    expect(guard.admit(10_001).admitted).toBe(false);
  });
});

describe('parseMemoryThresholdsMb', () => {
  it.each([
    [undefined, [256, 384, 448]],
    ['', [256, 384, 448]],
    ['100,200,300', [100, 200, 300]],
    ['300, 100, 200', [100, 200, 300]],
    ['512', [512]],
    ['abc,-5,0', [256, 384, 448]],
    ['abc,128', [128]],
  ])('parses %s -> %s', (raw, expected) => {
    expect(parseMemoryThresholdsMb(raw)).toEqual(expected);
  });
});

describe('createMemoryWatermark', () => {
  it('fires once per upward crossing and reports the highest threshold crossed', () => {
    const watermark = createMemoryWatermark([256, 384, 448]);
    expect(watermark.check(100 * MIB)).toBeNull();
    expect(watermark.check(260 * MIB)).toBe(256);
    expect(watermark.check(270 * MIB)).toBeNull();
    expect(watermark.check(460 * MIB)).toBe(448);
  });

  it('re-arms a threshold after memory drops back below it', () => {
    const watermark = createMemoryWatermark([256]);
    expect(watermark.check(300 * MIB)).toBe(256);
    expect(watermark.check(310 * MIB)).toBeNull();
    expect(watermark.check(200 * MIB)).toBeNull();
    expect(watermark.check(300 * MIB)).toBe(256);
  });

  it('stays silent while memory remains flat below every threshold', () => {
    const watermark = createMemoryWatermark([256, 384, 448]);
    expect(watermark.check(101 * MIB)).toBeNull();
    expect(watermark.check(102 * MIB)).toBeNull();
    expect(watermark.check(101 * MIB)).toBeNull();
  });
});
