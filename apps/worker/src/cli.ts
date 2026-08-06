export interface NumericArgOptions {
  /** Smallest accepted value (inclusive). */
  min?: number;
  /** Largest accepted value (inclusive). */
  max?: number;
  /** Numeric worker flags represent counts/durations, so integers are the safe default. */
  integer?: boolean;
}

/**
 * Read a numeric CLI flag in either `--name value` or `--name=value` form.
 *
 * Invalid, missing, duplicated, non-finite, and out-of-range values fail closed. This is
 * deliberately stricter than `Number(arg)` because a typo such as `--limit nope` used to
 * become NaN and silently disable the limit, turning a small maintenance run into a full
 * corpus crawl.
 */
export function numericArg(
  argv: readonly string[],
  name: string,
  opts: NumericArgOptions = {},
): number | undefined {
  const flag = `--${name}`;
  const inline = `${flag}=`;
  const matches = argv
    .map((token, index) => ({ token, index }))
    .filter(({ token }) => token === flag || token.startsWith(inline));

  if (matches.length === 0) return undefined;
  if (matches.length > 1) throw new Error(`${flag} may only be provided once`);

  const match = matches[0]!;
  const raw = match.token === flag ? argv[match.index + 1] : match.token.slice(inline.length);
  if (raw === undefined || raw === "" || (match.token === flag && raw.startsWith("--"))) {
    throw new Error(`${flag} requires a numeric value`);
  }

  const value = Number(raw);
  const { min, max, integer = true } = opts;
  if (!Number.isFinite(value)) throw new Error(`${flag} must be a finite number (received ${raw})`);
  if (integer && !Number.isInteger(value))
    throw new Error(`${flag} must be an integer (received ${raw})`);
  if (min !== undefined && value < min)
    throw new Error(`${flag} must be >= ${min} (received ${raw})`);
  if (max !== undefined && value > max)
    throw new Error(`${flag} must be <= ${max} (received ${raw})`);
  return value;
}
