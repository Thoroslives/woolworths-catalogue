import { appendFile, writeFile } from "node:fs/promises";
import {
  allLeafCategories,
  departmentCategories,
  foodDepartmentCategories,
  foodLeafCategories,
} from "../src/categories.js";
import { sweepStore } from "../src/catalogue.js";
import { readArgs } from "./argv.js";

/**
 * Walk one store's catalogue and write every product to a JSONL file, one
 * object per line.
 *
 *   npm run sweep -- --store 3304 --out sweep.jsonl
 *   npm run sweep -- --store 3304 --out sweep.jsonl --departments
 *   npm run sweep -- --store 3304 --out sweep.jsonl --limit 5      (a smoke run)
 *
 * The default reads all 1,475 leaf categories, because it is the only sweep
 * proved complete. Measured at one store on 2026-08-03 it found 31,647
 * distinct products in about thirty minutes. A product sits on several
 * shelves, so the file holds about four rows per product; dedupe on
 * `stockcode` if you want one row each.
 *
 * `--departments` reads the 25 "All <Department>" nodes instead: 28,882
 * products in seven minutes, missing 2,745 that are all greeting cards,
 * magazines and SIM packs. `--food-departments` reads twelve of them: 11,427
 * in three minutes, and it misses twenty four food products including chia,
 * flaxseed and LSA. `--food-leaves` reads every leaf under the food
 * departments.
 *
 * This touches no database. Load the file wherever you like.
 */

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2), ["--store", "--out", "--limit"]);
  const flag = (name: string): boolean => args.switches.has(name);
  const store = args.values["--store"];
  const out = args.values["--out"];
  if (!store || !out) {
    console.error(
      "Usage: npm run sweep -- --store <store number> --out <file.jsonl> " +
        "[--departments | --food-departments | --food-leaves] [--limit N]"
    );
    process.exitCode = 1;
    return;
  }

  const pool = flag("--departments")
    ? departmentCategories()
    : flag("--food-departments")
      ? foodDepartmentCategories()
      : flag("--food-leaves")
        ? foodLeafCategories()
        : allLeafCategories();
  const limit = Number(args.values["--limit"] ?? "0");
  const categories = limit > 0 ? pool.slice(0, limit) : pool;

  const started = Date.now();
  console.log(`Sweeping store ${store}: ${categories.length} categories into ${out}.`);
  await writeFile(out, "", "utf8");

  const summary = await sweepStore(
    store,
    {
      onCategory: async (_category, entries) => {
        if (entries.length === 0) return;
        await appendFile(
          out,
          `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
          "utf8"
        );
      },
      onProgress: (done, total, written) => {
        if (done % 25 === 0 || done === total) {
          const seconds = Math.round((Date.now() - started) / 1000);
          console.log(`  ${done}/${total} categories, ${written} products, ${seconds}s`);
        }
      },
    },
    { categories }
  );

  console.log(`\nwrote ${summary.productsWritten} products to ${out}.`);
  if (summary.truncated.length > 0) {
    console.log(`Page guard cut short: ${summary.truncated.join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
