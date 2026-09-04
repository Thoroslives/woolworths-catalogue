import { isDegradedResponse, unrequestedKeys } from "./degraded.js";
import {
  CategoryPath,
  mapProductByStockcode,
  mapProductCategoryPath,
  mapProductsByCategory,
} from "./productMapper.js";
import {
  PRODUCTS_BY_CATEGORY_QUERY,
  PRODUCT_DETAILS_QUERY,
  SUPPORTED_LINKS,
  paddedProductId,
} from "./queries.js";
import { ProductRow } from "./types.js";

/**
 * Everything this project reads from Woolworths comes through here, and it is thin on
 * purpose: the endpoint, the headers, one GET, and the retry that a silently
 * degraded answer earns. The rules about what a payload means live in the
 * mapper, where they can be tested against recordings.
 *
 * Nothing in the test suite calls this module. The one thing that does is
 * scripts/woolworthsSmoke.ts, which is run by hand.
 */

export const WOOLWORTHS_GRAPHQL_ENDPOINT =
  "https://prod.mobile-api.woolworths.com.au/hermes/iris/v1/graphql";

/**
 * Three headers, none of them a secret.
 *
 * Two of them are Apigee routing: without `x-apigee-location` the gateway
 * answers 401 and without `apigeex-domain` it answers an HTML routing error.
 * The third is the whole of the authentication story, because the gateway
 * refuses a short list of automation clients by User-Agent and waves everything
 * else through. `X-Api-Key` is not checked and is left out rather than carried
 * for show.
 *
 * The User-Agent is not the only thing the gateway judges a caller by. The same
 * request sent by curl is answered with the canned degraded payload every time,
 * where the same request from this client is answered with data, so the client
 * that sends it matters as much as what it calls itself. That is why the
 * degraded detector below is not optional.
 */
export const WOOLWORTHS_HEADERS: Record<string, string> = {
  "x-apigee-location": "apigeeX",
  "apigeex-domain": "wow",
  "User-Agent": "woolworths-catalogue/1.0",
};

/** GET. POST is gated on OAuth and answers 401 invalid_client. */
const METHOD = "GET";

const DEFAULT_ATTEMPTS = 3;

export class WoolworthsDegradedError extends Error {
  constructor(readonly keys: string[], readonly attempts: number) {
    super(
      `Woolworths answered a degraded payload ${attempts} times: it carried ` +
        `${keys.join(", ")}, which the query never asked for. Nothing was read.`
    );
    this.name = "WoolworthsDegradedError";
  }
}

/**
 * An empty feed is this client's fault, not the shop's.
 *
 * The gateway returns only the feed items whose inline fragments the query
 * spread, so a query that asks for nothing gets nothing, on a product with a
 * full page. Writing that as a row would record "the shop has never heard of
 * this" about a product sitting on the shelf, so it raises instead.
 */
export class WoolworthsEmptyFeedError extends Error {
  constructor(readonly stockcode: string, readonly storeNumber: string) {
    super(
      `Woolworths answered an empty feed for ${stockcode} at store ${storeNumber}. ` +
        `That means the query spread no fragment the gateway could match, not that ` +
        `the store does not carry it. Check PRODUCT_DETAILS_QUERY against SUPPORTED_LINKS.`
    );
    this.name = "WoolworthsEmptyFeedError";
  }
}

export interface WoolworthsRequestOptions {
  attempts?: number;
  fetchImpl?: typeof fetch;
}

export function woolworthsRequestUrl(query: string, variables: Record<string, unknown>): string {
  const url = new URL(WOOLWORTHS_GRAPHQL_ENDPOINT);
  url.searchParams.set("query", query);
  url.searchParams.set("variables", JSON.stringify(variables));
  return url.toString();
}

/**
 * Runs one GraphQL read and hands back the whole payload, retrying while the
 * answer is degraded. A degraded answer is HTTP 200 and looks like data, so it
 * is refused here rather than anywhere downstream.
 */
export async function fetchWoolworths(
  query: string,
  variables: Record<string, unknown>,
  options: WoolworthsRequestOptions = {}
): Promise<unknown> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const request = options.fetchImpl ?? fetch;
  let degradedKeys: string[] = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await request(woolworthsRequestUrl(query, variables), {
      method: METHOD,
      headers: WOOLWORTHS_HEADERS,
    });

    const payload = (await response.json().catch(() => null)) as {
      data?: unknown;
      errors?: unknown[];
    } | null;

    if (!response.ok) {
      throw new Error(
        `Woolworths answered HTTP ${response.status} ${response.statusText}: ${JSON.stringify(
          payload?.errors ?? payload
        )}`
      );
    }

    if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
      throw new Error(`Woolworths answered errors: ${JSON.stringify(payload.errors)}`);
    }

    if (!isDegradedResponse(query, payload?.data)) {
      return payload;
    }

    degradedKeys = unrequestedKeys(query, payload?.data);
  }

  throw new WoolworthsDegradedError(degradedKeys, attempts);
}

/**
 * A stockcode and a store number in, a row out. A store that does not range the
 * stockcode still produces a row, saying exactly that.
 */
export async function fetchProduct(
  stockcode: string,
  storeNumber: string,
  options?: WoolworthsRequestOptions
): Promise<ProductRow> {
  return (await fetchProductWithShelf(stockcode, storeNumber, options)).product;
}

/**
 * The same one call, with the shelf the product's own card names.
 *
 * A product the store cannot sell still answers with a card, and the card is
 * the only thing that says which shelf an alternative would sit on. Both
 * come off one read rather than two, because the panel and the path ride the
 * same payload.
 */
export async function fetchProductWithShelf(
  stockcode: string,
  storeNumber: string,
  options?: WoolworthsRequestOptions
): Promise<{ product: ProductRow; shelf: CategoryPath | null }> {
  const payload = (await fetchWoolworths(
    PRODUCT_DETAILS_QUERY,
    {
      productId: paddedProductId(stockcode),
      storeId: storeNumber,
      supportedLinks: SUPPORTED_LINKS,
    },
    options
  )) as { data?: { productDetails?: { feed?: unknown[] | null } | null } | null };

  const feed = payload?.data?.productDetails?.feed ?? [];
  if (feed.length === 0) {
    throw new WoolworthsEmptyFeedError(stockcode, storeNumber);
  }

  const typed = payload as Parameters<typeof mapProductByStockcode>[0];

  return {
    product: mapProductByStockcode(typed, stockcode, storeNumber),
    shelf: mapProductCategoryPath(typed),
  };
}

/**
 * How many products one page of a shelf answers with. The gateway's own
 * default. One page is enough to see what a shelf holds, and a shelf whose
 * right answer is on page four is a shelf nobody would scroll either.
 */
const CANDIDATE_PAGE_SIZE = 36;

/**
 * One shelf at one store, as rows.
 *
 * These carry aisle, bay and the shelf price, and no nutrition panel: the panel
 * does not ride this call and there is no batched read to buy it with, so a
 * candidate worth ranking is read again one at a time. That is what the
 * candidate cap is for.
 *
 * A store number nobody recognises answers zero products rather than a
 * plausible list, so an empty answer here is a usable signal and not a shrug.
 */
export async function fetchCategoryProducts(
  categoryId: string,
  storeNumber: string,
  options?: WoolworthsRequestOptions
): Promise<ProductRow[]> {
  const payload = await fetchWoolworths(
    PRODUCTS_BY_CATEGORY_QUERY,
    {
      categoryId,
      storeId: storeNumber,
      pageSize: CANDIDATE_PAGE_SIZE,
      pageNumber: 1,
    },
    options
  );

  return mapProductsByCategory(
    payload as Parameters<typeof mapProductsByCategory>[0],
    storeNumber
  );
}
