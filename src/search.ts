import type { CatalogueEntry } from "./catalogueTypes.js";

/**
 * Search over a sweep, in memory. The README restates these rules in SQL for
 * anyone who loads a sweep into Postgres; this file is the reference.
 *
 * Every word typed has to appear somewhere in the name. What is found is then
 * ordered so the row somebody meant comes first:
 *
 *   1. on the shelf today before not
 *   2. more of the words matched as whole words, plural allowed, so "tomato"
 *      counts in "Tomatoes" but not in "Tomatoey"
 *   3. more of them matched exactly, so "Tomato Sauce" beats "Tomatoes 500g"
 *   4. the words nearer the front of the name
 *   5. the shorter name, which is usually the plain product rather than a
 *      variant of it
 *   6. the name, so ties are stable
 *
 * A sweep holds one row per shelf a product sits on, about four per product,
 * so rows are collapsed to one per store and stockcode first, keeping a row
 * that says available over one that does not.
 */
export function searchEntries(entries: CatalogueEntry[], term: string, limit: number): CatalogueEntry[] {
  const words = term.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const patterns = words.map(wordPatterns);

  return dedupeByStoreAndStockcode(entries)
    .filter((entry) => {
      const name = entry.name.toLowerCase();
      return words.every((word) => name.includes(word));
    })
    .map((entry) => ({ entry, rank: rankOf(entry, words, patterns) }))
    .sort((a, b) => compareRanks(a.rank, b.rank))
    .slice(0, limit)
    .map((ranked) => ranked.entry);
}

/** One row per store and stockcode. An available row wins over an unavailable one. */
export function dedupeByStoreAndStockcode(entries: CatalogueEntry[]): CatalogueEntry[] {
  const byKey = new Map<string, CatalogueEntry>();
  for (const entry of entries) {
    const key = `${entry.storeNumber}\t${entry.stockcode}`;
    const held = byKey.get(key);
    if (!held || (!held.isAvailable && entry.isAvailable)) {
      byKey.set(key, entry);
    }
  }
  return [...byKey.values()];
}

interface Rank {
  offShelf: number;
  wholeWords: number;
  exactWords: number;
  positions: number;
  length: number;
  name: string;
}

interface WordPatterns {
  whole: RegExp;
  exact: RegExp;
}

/**
 * A word boundary that knows a letter when it sees one. JavaScript's `\b` is
 * ASCII only, so "café" would never count as a whole word; Postgres's `\y`
 * does count it, and the two have to agree.
 */
function wordPatterns(word: string): WordPatterns {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const before = "(?<![\\p{L}\\p{N}])";
  const after = "(?![\\p{L}\\p{N}])";
  return {
    whole: new RegExp(`${before}${escaped}(e?s)?${after}`, "u"),
    exact: new RegExp(`${before}${escaped}${after}`, "u"),
  };
}

function rankOf(entry: CatalogueEntry, words: string[], patterns: WordPatterns[]): Rank {
  const name = entry.name.toLowerCase();
  let wholeWords = 0;
  let exactWords = 0;
  let positions = 0;
  words.forEach((word, i) => {
    if (patterns[i].whole.test(name)) wholeWords += 1;
    if (patterns[i].exact.test(name)) exactWords += 1;
    positions += name.indexOf(word);
  });
  return { offShelf: entry.isAvailable ? 0 : 1, wholeWords, exactWords, positions, length: name.length, name };
}

function compareRanks(a: Rank, b: Rank): number {
  return (
    a.offShelf - b.offShelf ||
    b.wholeWords - a.wholeWords ||
    b.exactWords - a.exactWords ||
    a.positions - b.positions ||
    a.length - b.length ||
    (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  );
}
