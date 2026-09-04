/**
 * The two reads this project makes of the Woolworths gateway, both measured against
 * the live schema rather than transcribed from documentation.
 *
 * Every one of them is a GET. POST is gated on OAuth and answers
 * `401 invalid_client`.
 *
 * Ask for the selection set and nothing else. The degraded detector reads a key
 * the query did not name as a canned answer, so a field asked for and ignored
 * costs nothing and a field returned but not asked for is a retry.
 *
 * Server side introspection is off, so the fields below come from the Android
 * client's own query documents, which ship as plain strings in the dex and are
 * the only complete account of this schema anybody outside Woolworths has.
 * `ProductCard` carries no `brand`, no `packageSize` and no `status`, which is
 * why the mapper reads a pack size out of the product name.
 *
 * ## Two traps, both of which have already cost a day
 *
 * **This gateway returns only the feed items whose inline fragments the query
 * actually spreads.** `feed { __typename }` answers with an empty list on a
 * product that has a full page. So the ordinary way to explore a union, ask
 * what types come back and select them afterwards, reports nothing here however
 * right everything else is, and it reads as a closed door rather than a wrong
 * question. Ask for what you want by fragment or you get nothing. It is also
 * why an empty feed is this client's bug rather than an answer.
 *
 * **A product id is the stockcode padded to eighteen digits.** `23038` is
 * accepted and answers nothing at all; `000000000000023038` answers. The
 * padding goes on at the wire and comes off in the mapper, so nothing above
 * this layer ever sees it.
 */

/**
 * The feed items this project can read. The gateway drops any item whose type is not
 * named here, and it is the same list the query spreads fragments for, because
 * one without the other is a silent hole.
 */
export const SUPPORTED_LINKS = ["ProductCard", "ProductNutritionInfo"];

/**
 * `categories` is asked for on both calls, because a field belongs to the type
 * and not to the call that reaches it: `ProductCard` carries its three level
 * path wherever it is read. That is what makes an unsellable product's own card
 * the way back to the shelf it came off, which is where an alternative would be.
 *
 * The path arrives as names and never as ids, so `findCategoryByPath` is what
 * turns it into the `categoryId` `productsByCategory` will accept.
 */
const PRODUCT_CARD_FIELDS = `
        categories { name categoryLevel }
        productId
        name
        price
        isAvailable
        unitPriceDescription
        inStoreDetails { locationText locationType }
        inStoreLocation { details { aisleNumber aisleSide bayNumber location } }
`;

/**
 * One product at one store, with its nutrition panel, in one call.
 *
 * `productDetails` answers with a card for every stockcode, including one this
 * store has never carried, so an empty answer is not how "not ranged" arrives.
 * The availability rules in the mapper are what separate the four cases, and
 * each of them is pinned by a recording.
 *
 * The panel is absent rather than empty on a product that has none: fresh
 * produce carries no panel and neither does toilet paper.
 */
export const PRODUCT_DETAILS_QUERY = `
query ProductDetails($productId: String, $storeId: String, $supportedLinks: [String!]) {
  productDetails(productId: $productId, storeId: $storeId, supportedLinks: $supportedLinks) {
    feed {
      __typename
      ... on ProductCard {
${PRODUCT_CARD_FIELDS}      }
      ... on ProductNutritionInfo {
        title
        servingSize
        servingsPerPack
        tableHeaderRow
        tableRows
      }
    }
  }
}
`;

/**
 * One category page at one store: ask, and read what comes back with aisle
 * and bay attached.
 *
 * `excludeUnavailableProducts` is accepted and ignored by the server, so the
 * unavailable products are in the feed whatever is passed and the client is the
 * one that filters. It is not asked for, for that reason.
 *
 * The nutrition panel does not ride this call. A candidate worth ranking is
 * bought one at a time with `PRODUCT_DETAILS_QUERY`, which is what makes the
 * candidate cap worth having.
 */
export const PRODUCTS_BY_CATEGORY_QUERY = `
query ProductsByCategory($categoryId: String!, $storeId: String, $pageSize: Int, $pageNumber: Int) {
  productsByCategory(categoryId: $categoryId, storeId: $storeId, pageSize: $pageSize, pageNumber: $pageNumber) {
    totalNumberOfProducts
    nextPage
    productsFeed {
      __typename
      ... on ProductCard {
${PRODUCT_CARD_FIELDS}      }
    }
  }
}
`;

/**
 * The stockcode as the wire wants it. A stockcode is written the way a person
 * reads it off a shelf label, and this is the only place that difference exists.
 */
export function paddedProductId(stockcode: string): string {
  const digits = String(stockcode ?? "").trim();
  return /^\d+$/.test(digits) ? digits.padStart(18, "0") : digits;
}
