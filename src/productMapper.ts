import { mapNutrition } from "./nutrition.js";
import { parsePackSize } from "./packSize.js";
import { ProductAvailability, ProductLocation, ProductRow } from "./types.js";

/**
 * The seam between Woolworths and this project. A recorded response goes in and a
 * product row comes out, with no network and no clock, so every rule below is
 * pinned by a fixture in data/fixtures that was recorded off the
 * live gateway rather than written to match this file.
 *
 * Woolworths is a private API and any of it can change without notice. When it
 * does, it is this file and those fixtures that change and nothing else.
 */

interface RawLocationDetails {
  aisleNumber?: number | null;
  aisleSide?: string | null;
  bayNumber?: number | null;
  location?: string | null;
}

export interface RawProductCard {
  /** The three level path, as names. Absent on a card read by an older query. */
  categories?: { name?: string | null; categoryLevel?: number | null }[] | null;
  productId?: string | number | null;
  name?: string | null;
  /** Cents. Null when the store cannot sell it today. */
  price?: number | null;
  isAvailable?: boolean | null;
  unitPriceDescription?: string | null;
  inStoreDetails?: { locationText?: string | null; locationType?: string | null } | null;
  inStoreLocation?: { details?: RawLocationDetails | null } | null;
}

/** A feed item is one of the types the query spread a fragment for. */
type RawFeedItem = (RawProductCard & { __typename?: string | null }) | RawNutritionItem;

interface RawNutritionItem {
  __typename?: string | null;
  title?: string | null;
  servingSize?: string | null;
  servingsPerPack?: string | null;
  tableHeaderRow?: string[] | null;
  tableRows?: string[][] | null;
}

interface RawResponse {
  data?: {
    productDetails?: { feed?: RawFeedItem[] | null } | null;
    productsByCategory?: { productsFeed?: RawProductCard[] | null } | null;
  } | null;
}

/**
 * One store's answer about one stockcode, card and panel together.
 *
 * Unlike the search this call replaced, `productDetails` answers with a card for
 * every stockcode, including one the store has never carried. So an empty feed
 * is not how "not ranged" arrives: the availability rules below are, and each of
 * the four cases is pinned by a recording. An empty feed means this client
 * spread no matching fragment, which is a bug here rather than an answer from
 * Woolworths, and it is why the client raises on one instead of writing a row
 * saying the shop has nothing.
 */
export function mapProductByStockcode(
  response: RawResponse,
  stockcode: string,
  storeNumber: string
): ProductRow {
  const feed = response?.data?.productDetails?.feed ?? [];
  const card = feed.find(isProductCard);

  if (!card) return notRanged(normaliseStockcode(stockcode), storeNumber);

  return {
    ...mapProductCard(card, storeNumber),
    // The stockcode asked for wins over the one the wire echoed back, because that
    // is what this row has to be found by later.
    stockcode: normaliseStockcode(stockcode),
    nutrition: mapNutrition(feed.find(isNutritionPanel) ?? null),
  };
}

/**
 * The three level shelf path a card names, or null when it names none.
 *
 * A product the store cannot sell is still a card, and the card says which
 * shelf the product belongs on, which is where an alternative would sit. The
 * path is names rather than ids, so `findCategoryByPath` is what turns it into
 * something `productsByCategory` will take.
 *
 * Level two is read and carried even though nothing matches on it, because a
 * path with a hole in it is worth seeing when a lookup fails.
 */
export interface CategoryPath {
  level1: string | null;
  level2: string | null;
  level3: string | null;
}

export function readCategoryPath(card: RawProductCard): CategoryPath | null {
  const path = card.categories ?? [];
  const atLevel = (level: number) =>
    path.find((entry) => entry?.categoryLevel === level)?.name?.trim() || null;

  const categoryPath = { level1: atLevel(1), level2: atLevel(2), level3: atLevel(3) };

  // Only the outer two are matched on, so a card missing either of them names
  // no shelf this app can ask about.
  return categoryPath.level1 && categoryPath.level3 ? categoryPath : null;
}

/** The shelf one stockcode's own product card names, off a `productDetails` read. */
export function mapProductCategoryPath(response: RawResponse): CategoryPath | null {
  const card = (response?.data?.productDetails?.feed ?? []).find(isProductCard);
  return card ? readCategoryPath(card) : null;
}

function isProductCard(item: RawFeedItem): item is RawProductCard & { __typename?: string | null } {
  return item?.__typename === "ProductCard";
}

function isNutritionPanel(item: RawFeedItem): item is RawNutritionItem {
  return item?.__typename === "ProductNutritionInfo";
}

export function mapProductsByCategory(response: RawResponse, storeNumber: string): ProductRow[] {
  const feed = response?.data?.productsByCategory?.productsFeed ?? [];
  // The feed carries cards of more than one type, and only a ProductCard has a
  // product on it.
  return feed
    .filter((card) => card?.productId !== undefined && card?.productId !== null)
    .map((card) => mapProductCard(card, storeNumber));
}

export function mapProductCard(card: RawProductCard, storeNumber: string): ProductRow {
  const { availability, isRanged } = readAvailability(card);

  return {
    stockcode: normaliseStockcode(card.productId),
    storeNumber,
    name: card.name?.trim() ?? "",
    price: readPrice(card.price),
    unitPriceDescription: card.unitPriceDescription?.trim() || null,
    // The card carries no pack size field, so the name is where the pack is.
    ...parsePackSize(card.name),
    availability,
    isRanged,
    // The panel rides the product read and nothing else, so a card mapped on
    // its own carries none. A candidate worth ranking is read again by
    // stockcode, which is what the candidate cap is for.
    nutrition: null,
    ...readLocation(card),
  };
}

/** What is recorded about a stockcode the store's own feed does not carry. */
export function notRanged(stockcode: string, storeNumber: string): ProductRow {
  return {
    stockcode: normaliseStockcode(stockcode),
    storeNumber,
    name: "",
    price: null,
    unitPriceDescription: null,
    packDisplay: null,
    packAmount: null,
    packUnit: null,
    availability: "not_ranged",
    isRanged: false,
    nutrition: null,
    locationText: null,
    locationZone: null,
    aisleNumber: null,
    aisleSide: null,
    bayNumber: null,
  };
}

/**
 * The wire pads a stockcode to eighteen characters: 23038 comes back as
 * 000000000000023038. A stockcode is written the way a person reads it off a
 * shelf label, so the padding is stripped here rather than carried into a file
 * where it would never match and would happily hold the same product twice.
 */
export function normaliseStockcode(productId: string | number | null | undefined): string {
  const text = String(productId ?? "").trim();
  return /^\d+$/.test(text) ? String(Number(text)) : text;
}

/**
 * The wire carries cents. `price: 280` on a 450 g tofu is $2.80, which the
 * card's own `unitPriceDescription` of "$6.22 per 1kg" confirms. Storing it
 * unconverted puts every price out by a factor of a hundred.
 *
 * Null is a price we do not have, and so is a zero. Never read either as free.
 */
export function readPrice(cents: number | null | undefined): number | null {
  if (typeof cents !== "number" || !Number.isFinite(cents) || cents <= 0) return null;
  return Math.round(cents) / 100;
}

/**
 * `inStoreLocation.details` being non-null is what says the store ranges a
 * product, and the outer `inStoreLocation` object is never what is tested: it
 * comes back either way, carrying a null `details`, so testing the outer object
 * marks a product the store has never carried as ranged and sends somebody
 * looking for it.
 *
 * A null `details` therefore has to earn its way back to ranged, and the
 * default when nothing says otherwise is that the store does not carry it. Two
 * measured cases earn it:
 *
 *   - `inStoreDetails.locationType` reads AVAILABLE. Fresh produce has no shelf
 *     co-ordinates anywhere in the store and reads "Produce Department"; some
 *     perimeter shelves read a plain aisle name the same way.
 *   - the store says it is available today. One store sells a 40 pack of toilet
 *     paper it will not place, reading "See in store", which is ranged with
 *     the stock unknown.
 *
 * Anything else, including a card carrying no `inStoreDetails` block at all, is
 * a product the store never carries.
 */
function readAvailability(card: RawProductCard): {
  availability: ProductAvailability;
  isRanged: boolean;
} {
  const details = card.inStoreLocation?.details ?? null;
  const available = card.isAvailable === true;

  if (details !== null || card.inStoreDetails?.locationType?.trim().toUpperCase() === "AVAILABLE") {
    return { availability: available ? "in_stock" : "unavailable", isRanged: true };
  }

  if (available) {
    // Ranged, and the store will not say where or whether. Go and look.
    return { availability: "see_in_store", isRanged: true };
  }

  return { availability: "not_ranged", isRanged: false };
}

function readLocation(card: RawProductCard): ProductLocation {
  const details = card.inStoreLocation?.details ?? null;

  return {
    // "Aisle 6", "Dairy", "Produce Department": what the store tells a shopper.
    locationText: card.inStoreDetails?.locationText?.trim() || null,
    // An aisle number only means the printed aisle inside CENTRE OF STORE:
    // aisle 12 of the freezer section and aisle 12 of the shop are two places.
    locationZone: details?.location?.trim() || null,
    aisleNumber: readInteger(details?.aisleNumber),
    aisleSide: details?.aisleSide?.trim() || null,
    bayNumber: readInteger(details?.bayNumber),
  };
}

function readInteger(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}
