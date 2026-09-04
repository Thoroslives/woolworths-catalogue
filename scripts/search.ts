import { readFileSync } from "node:fs";
import { parseCatalogueEntry } from "../src/catalogueTypes.js";
import { searchEntries } from "../src/search.js";
import { readArgs } from "./argv.js";

/**
 * Search a sweep file.
 *
 *   npm run search -- --file sweep.jsonl tofu
 *   npm run search -- --file sweep.jsonl beyond meat --limit 5
 *
 * Reads the JSONL that `npm run sweep` wrote and never calls Woolworths. Every
 * word has to appear in the product name, and the order is the one in
 * src/search.ts: on the shelf first, whole words before fragments, shorter
 * names before longer.
 */

function main(): void {
  const args = readArgs(process.argv.slice(2), ["--file", "--limit"]);
  const file = args.values["--file"];
  const term = args.positional.join(" ");
  const limitText = args.values["--limit"] ?? "12";
  const limit = Number(limitText);

  if (!file || !term || !Number.isInteger(limit) || limit < 1) {
    console.error("Usage: npm run search -- --file <sweep.jsonl> <words...> [--limit N]");
    process.exitCode = 1;
    return;
  }

  const entries = readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line, i) => {
      try {
        return parseCatalogueEntry(JSON.parse(line));
      } catch (error) {
        throw new Error(`${file} line ${i + 1}: ${error instanceof Error ? error.message : error}`);
      }
    });

  const results = searchEntries(entries, term, limit);
  if (results.length === 0) {
    console.log(`Nothing in ${file} matches "${term}". If the sweep behind it was cut short, that proves nothing.`);
    return;
  }

  for (const entry of results) {
    const price = entry.price === null ? "      " : `$${entry.price.toFixed(2).padStart(5)}`;
    const shelf = entry.isAvailable ? "in stock  " : "not today ";
    const where = (entry.locationText ?? "").padEnd(12);
    console.log(`${entry.stockcode.padStart(8)}  ${price}  ${shelf}  ${where}  ${entry.name}`);
  }
}

main();
