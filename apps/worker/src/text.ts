/**
 * Tiny shared text-matching helpers — accent folding and stopword tokenization —
 * used by both the feed ingester (ingest-feed.ts, bill-title bigrams) and the
 * account seeder (feed-accounts.seed.ts, name → legislator matching). One
 * implementation so the two matchers can't drift apart.
 */

/** Accent-fold + lowercase for matching names/titles against free text. */
export const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Normalized significant tokens: accent-folded, non-alphanumerics stripped,
 * dropping tokens shorter than `minLength` and anything in `stopwords`.
 * Callers supply their own stopword set — the ingester's is broad (generic
 * geographic/institutional terms), the seeder's is just name particles.
 */
export function tokenize(
  s: string,
  opts: { minLength: number; stopwords: ReadonlySet<string> },
): string[] {
  return norm(s)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= opts.minLength && !opts.stopwords.has(t));
}
