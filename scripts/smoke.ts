import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  WOOLWORTHS_GRAPHQL_ENDPOINT,
  fetchWoolworths,
  woolworthsRequestUrl,
} from "../src/client.js";
import { mapProductByStockcode, mapProductsByCategory } from "../src/productMapper.js";
import {
  STORE_LOCATOR_HEADERS,
  mapStoreLocatorResponse,
  storeLocatorUrl,
} from "../src/storeLocator.js";
import {
  PRODUCTS_BY_CATEGORY_QUERY,
  PRODUCT_DETAILS_QUERY,
  SUPPORTED_LINKS,
  paddedProductId,
} from "../src/queries.js";

/**
 * The one thing in this repository that calls Woolworths, run by hand and never
 * by the test suite:
 *
 *   npm run smoke -- --store 3304 --stockcode 23038
 *   npm run smoke -- --store 3304 --category 1_2DDBF53
 *   npm run smoke -- --store 3304 --stockcode 23038 --record in-stock-perimeter
 *   npm run smoke -- --postcode 3000
 *
 * It reads one product, or one category, at one store, prints the row the
 * mapper made of it, and with --record writes the raw response into
 * data/fixtures so the suite is pinned to something real. It touches no
 * database.
 *
 * `--postcode` reads the website rather than the mobile gateway: the stores near
 * a postcode, which is how you find a store number. It needs no store number,
 * because it is not store aware.
 *
 * There is deliberately no `--search` here. The website search is national and
 * misses stock the store carries, so searching is a read of the JSONL that
 * `npm run sweep` writes, not a call. See the README.
 *
 * Woolworths is a private API. When a call that used to work stops working,
 * this is where to find out what changed.
 */

const FIXTURES_DIR = path.join(process.cwd(), "data", "fixtures");

interface Options {
  store?: string;
  stockcode?: string;
  category?: string;
  postcode?: string;
  pageSize: number;
  record?: string;
}

function parseOptions(argv: string[]): Options {
  const value = (flag: string) => {
    const at = argv.indexOf(flag);
    if (at === -1) return undefined;
    const next = argv[at + 1];
    return next && !next.startsWith("--") ? next : "";
  };

  const store = value("--store");
  const stockcode = value("--stockcode");
  const category = value("--category");
  const postcode = value("--postcode");

  const wantsStore = Boolean(stockcode || category);
  if (!postcode && (!store || !wantsStore)) {
    throw new Error(
      "Usage: npm run smoke -- --store <store number> " +
        "(--stockcode <stockcode> | --category <category id>) " +
        "[--page-size <n>] [--record <fixture name>]\n" +
        "   or: npm run smoke -- --postcode <postcode> [--record <fixture name>]"
    );
  }

  return {
    store,
    stockcode,
    category,
    postcode,
    pageSize: Number(value("--page-size")) || 36,
    record: value("--record"),
  };
}

async function record(options: Options, payload: unknown, fallbackName: string) {
  if (options.record === undefined) return;

  const file = path.join(FIXTURES_DIR, `${options.record || fallbackName}.json`);
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[smoke] recorded ${file}`);
}

/** The website's store locator: a postcode in, the shops near it out. */
async function locateStores(options: Options) {
  const url = storeLocatorUrl(options.postcode as string);
  console.log(`[smoke] GET ${url}`);

  const response = await fetch(url, { headers: STORE_LOCATOR_HEADERS });
  if (!response.ok) {
    throw new Error(`The store locator answered HTTP ${response.status}.`);
  }

  const payload = await response.json();
  await record(options, payload, `store-locator-${options.postcode}`);
  console.log(JSON.stringify(mapStoreLocatorResponse(payload), null, 2));
}

async function main() {
  const options = parseOptions(process.argv.slice(2));

  if (options.postcode) {
    return locateStores(options);
  }

  const byStockcode = Boolean(options.stockcode);

  const store = options.store as string;
  const query = byStockcode ? PRODUCT_DETAILS_QUERY : PRODUCTS_BY_CATEGORY_QUERY;
  const variables = byStockcode
    ? {
        productId: paddedProductId(options.stockcode as string),
        storeId: store,
        supportedLinks: SUPPORTED_LINKS,
      }
    : {
        categoryId: options.category,
        storeId: store,
        pageSize: options.pageSize,
        pageNumber: 1,
      };

  console.log(`[smoke] ${WOOLWORTHS_GRAPHQL_ENDPOINT}`);
  console.log(`[smoke] GET ${woolworthsRequestUrl(query, variables)}`);

  const payload = await fetchWoolworths(query, variables);

  await record(
    options,
    payload,
    byStockcode ? `product-${options.stockcode}-${store}` : `category-${store}`
  );

  const rows = byStockcode
    ? [
        mapProductByStockcode(
          payload as Parameters<typeof mapProductByStockcode>[0],
          options.stockcode as string,
          store
        ),
      ]
    : mapProductsByCategory(payload as Parameters<typeof mapProductsByCategory>[0], store);

  console.log(JSON.stringify(rows, null, 2));

  for (const row of rows.filter((candidate) => !candidate.isRanged)) {
    console.log(`[smoke] ${store} does not shelve ${row.stockcode}`);
  }
}

main().catch((error) => {
  console.error("[smoke] Failed");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
