import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  WOOLWORTHS_GRAPHQL_ENDPOINT,
  WoolworthsDegradedError,
  fetchProduct,
} from "../../../src/client.js";
import { sweepStore } from "../../../src/catalogue.js";
import { findCategoryById, type LeafCategory } from "../../../src/categories.js";

/**
 * Drive the real client end to end with a stub `fetch` that serves recorded
 * responses from data/fixtures. Nothing here reaches the network: the stub
 * throws on any URL that is not the gateway, and never calls the real fetch.
 *
 *   npx tsx .claude/skills/verify/offline.ts sweep 3304 /tmp/ww-verify/sweep.jsonl
 *   npx tsx .claude/skills/verify/offline.ts product 3304 23038 details-in-stock-perimeter
 *   npx tsx .claude/skills/verify/offline.ts degraded 3304 23038
 *
 * The store number labels the rows and nothing else. The stub ignores it, and
 * the recordings come from the stores named in data/fixtures/README.md.
 */

const FIXTURES = path.join(process.cwd(), "data", "fixtures");

/** The three category recordings, by the category id each one is a read of. */
const CATEGORY_FIXTURES: Record<string, string> = {
  "1_2DDBF53": "category-vegetarian",
  "1_B7EF010": "category-cheese-promotions",
  "1_B5E7442": "category-single-meals-multibuy",
};

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), "utf8"));
}

function answer(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function variablesOf(input: string | URL | Request): Record<string, unknown> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (`${url.origin}${url.pathname}` !== WOOLWORTHS_GRAPHQL_ENDPOINT) {
    throw new Error(`The stub refuses ${url.origin}${url.pathname}. Only the gateway is served.`);
  }
  return JSON.parse(url.searchParams.get("variables") ?? "{}");
}

/**
 * Page 1 of each category is the recording. Two recordings say a page 2
 * exists, and nothing recorded page 2, so it answers an empty last page.
 */
const categoryStub: typeof fetch = async (input) => {
  const variables = variablesOf(input);
  const name = CATEGORY_FIXTURES[String(variables.categoryId)];
  if (!name) throw new Error(`No recording for category ${variables.categoryId}.`);
  if (variables.pageNumber === 1) return answer(fixture(name));
  return answer({
    data: { productsByCategory: { totalNumberOfProducts: 0, nextPage: null, productsFeed: [] } },
  });
};

function oneFixtureStub(name: string): typeof fetch {
  return async (input) => {
    variablesOf(input);
    return answer(fixture(name));
  };
}

async function sweep(store: string, out: string): Promise<void> {
  const categories = Object.keys(CATEGORY_FIXTURES).map((id) => {
    const category = findCategoryById(id);
    if (!category) throw new Error(`${id} is not in data/category-taxonomy.json.`);
    return category;
  });

  const lines: string[] = [];
  const summary = await sweepStore(
    store,
    {
      onCategory: async (category: LeafCategory, entries) => {
        console.log(`  ${category.categoryId} ${category.level3}: ${entries.length} rows`);
        lines.push(...entries.map((entry) => JSON.stringify(entry)));
      },
    },
    { categories, fetchImpl: categoryStub }
  );

  writeFileSync(out, lines.length > 0 ? `${lines.join("\n")}\n` : "", "utf8");
  console.log(
    `wrote ${summary.productsWritten} rows from ${summary.categoriesDone} of ` +
      `${summary.categoriesTotal} categories to ${out}. Truncated: ${summary.truncated.length}.`
  );
}

async function product(store: string, stockcode: string, name: string): Promise<void> {
  const row = await fetchProduct(stockcode, store, { fetchImpl: oneFixtureStub(name) });
  console.log(JSON.stringify(row, null, 2));
}

async function degraded(store: string, stockcode: string): Promise<void> {
  try {
    await fetchProduct(stockcode, store, { fetchImpl: oneFixtureStub("degraded-response") });
  } catch (error) {
    if (error instanceof WoolworthsDegradedError) {
      console.log(`refused as expected after ${error.attempts} attempts: ${error.message}`);
      return;
    }
    throw error;
  }
  throw new Error("The degraded recording was read as data.");
}

async function main(): Promise<void> {
  const [mode, store, a, b] = process.argv.slice(2);
  if (mode === "sweep" && store && a) return sweep(store, a);
  if (mode === "product" && store && a && b) return product(store, a, b);
  if (mode === "degraded" && store && a) return degraded(store, a);
  console.error(
    "Usage: offline.ts sweep <store> <out.jsonl>\n" +
      "   or: offline.ts product <store> <stockcode> <fixture name>\n" +
      "   or: offline.ts degraded <store> <stockcode>"
  );
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
