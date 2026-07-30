const MAX_LOGGED_PATH_LENGTH = 200;
const DEFAULT_MEMORY_THRESHOLDS_MB = [256, 384, 448];

export const FLOOD_WINDOW_MS = 10_000;
export const FLOOD_MAX_REQUESTS = 200;

/** Kubelet health probes identify themselves via User-Agent; logging them would drown real traffic. */
export function isProbeRequest(userAgent: string | null): boolean {
  return userAgent !== null && userAgent.startsWith('kube-probe/');
}

/** Never logs query strings (they can carry OAuth exchange codes); caps length against scanner URLs. */
export function formatLoggedPath(pathname: string): string {
  if (pathname.length <= MAX_LOGGED_PATH_LENGTH) return pathname;
  return `${pathname.slice(0, MAX_LOGGED_PATH_LENGTH)}...(truncated)`;
}

export interface FloodGuardDecision {
  admitted: boolean;
  suppressedInPriorWindow: number;
}

export interface FloodGuard {
  admit: (nowMs: number) => FloodGuardDecision;
}

/**
 * Caps logged requests per fixed window so a request flood can't amplify into
 * a log flood; the count of suppressed requests is surfaced once when the
 * next window opens, so the flood itself stays visible.
 */
export function createFloodGuard(
  maxRequests: number = FLOOD_MAX_REQUESTS,
  windowMs: number = FLOOD_WINDOW_MS,
): FloodGuard {
  let windowStart = 0;
  let admittedInWindow = 0;
  let suppressedInWindow = 0;

  return {
    admit(nowMs: number): FloodGuardDecision {
      let suppressedInPriorWindow = 0;
      if (nowMs - windowStart >= windowMs) {
        suppressedInPriorWindow = suppressedInWindow;
        windowStart = nowMs;
        admittedInWindow = 0;
        suppressedInWindow = 0;
      }
      if (admittedInWindow < maxRequests) {
        admittedInWindow += 1;
        return { admitted: true, suppressedInPriorWindow };
      }
      suppressedInWindow += 1;
      return { admitted: false, suppressedInPriorWindow };
    },
  };
}

export function parseMemoryThresholdsMb(raw: string | undefined): number[] {
  if (!raw) return DEFAULT_MEMORY_THRESHOLDS_MB;
  const parsed = raw
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (parsed.length === 0) return DEFAULT_MEMORY_THRESHOLDS_MB;
  return [...parsed].sort((a, b) => a - b);
}

export interface MemoryWatermark {
  /** Returns the highest threshold (in MiB) newly crossed upward, or null. */
  check: (rssBytes: number) => number | null;
}

const BYTES_PER_MIB = 1024 * 1024;

/**
 * Fires once per upward crossing of each threshold; a threshold re-arms when
 * RSS drops back below it, so a sawtooth pattern logs each climb without
 * repeating on every tick spent above a threshold.
 */
export function createMemoryWatermark(thresholdsMb: number[]): MemoryWatermark {
  let lastRssMb = 0;

  return {
    check(rssBytes: number): number | null {
      const rssMb = rssBytes / BYTES_PER_MIB;
      let crossed: number | null = null;
      for (const threshold of thresholdsMb) {
        if (lastRssMb < threshold && rssMb >= threshold) crossed = threshold;
      }
      lastRssMb = rssMb;
      return crossed;
    },
  };
}
