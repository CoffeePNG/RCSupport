const UNIT_MS: Record<string, number> = {
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

const DURATION_PATTERN = /(\d+)([mhdw])/g;

/** Maximum window a single archive may look back over. */
export const MAX_DURATION_MS = 90 * UNIT_MS.d;

/**
 * Parses a compact duration string such as "30m", "24h", "7d" or "1w2d".
 * Returns null when the input contains no valid duration parts.
 */
export function parseDuration(input: string): number | null {
  const normalized = input.toLowerCase().replace(/\s+/g, "");
  if (!normalized) return null;

  let total = 0;
  let matched = false;
  let consumed = 0;

  DURATION_PATTERN.lastIndex = 0;
  for (const match of normalized.matchAll(DURATION_PATTERN)) {
    const amount = Number(match[1]);
    const unit = UNIT_MS[match[2]];
    if (!Number.isFinite(amount) || !unit) return null;
    total += amount * unit;
    consumed += match[0].length;
    matched = true;
  }

  if (!matched) return null;
  // Reject stray characters like "7dx" or "abc7d".
  if (consumed !== normalized.length) return null;
  if (total <= 0) return null;
  return total;
}

export function formatDuration(ms: number): string {
  const parts: string[] = [];
  let remaining = ms;
  for (const [unit, size] of [
    ["w", UNIT_MS.w],
    ["d", UNIT_MS.d],
    ["h", UNIT_MS.h],
    ["m", UNIT_MS.m],
  ] as const) {
    const value = Math.floor(remaining / size);
    if (value > 0) {
      parts.push(`${value}${unit}`);
      remaining -= value * size;
    }
  }
  return parts.join(" ") || "0m";
}
