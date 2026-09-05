import type * as t from '@/types';

function isStrictPathPrefix(prefix: string, path: string): boolean {
  return path.startsWith(`${prefix}.`);
}

/** Deduplicate reset paths and drop descendants when an ancestor is already reset. */
export function canonicalizeResetPaths(paths: string[]): string[] {
  const unique = [...new Set(paths)];
  return unique.filter(
    (path) => !unique.some((other) => other !== path && isStrictPathPrefix(other, path)),
  );
}

export function getValueAtPath(
  source: Record<string, t.ConfigValue>,
  fieldPath: string,
): { found: true; value: t.ConfigValue } | { found: false } {
  const parts = fieldPath.split('.');
  let current: unknown = source;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return { found: false };
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return { found: false };
      current = current[index];
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(current, part)) return { found: false };
    current = (current as Record<string, unknown>)[part];
  }
  return { found: true, value: current as t.ConfigValue };
}
