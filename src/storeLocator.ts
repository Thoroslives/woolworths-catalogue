/**
 * A postcode in, the stores near it out.
 *
 * This is the website's own store locator rather than the mobile gateway, and
 * it is the only proven route from a postcode to a store number: the gateway
 * carries no store search at all. It is a plain REST GET on
 * www.woolworths.com.au, so none of the Apigee routing headers apply and the
 * degraded detector, which is a rule about a GraphQL selection set, has nothing
 * to say about it.
 *
 * It runs once per store added and never on the weekly path.
 *
 * ## The trap, which cost a call to find
 *
 * `Latitude` and `Longitude` sent empty alongside a `Name` answers HTTP 400
 * with an error body that says 500 and means nothing. Two argument sets work
 * and this module sends the second:
 *
 *   - a real latitude and longitude, which nothing in this project has, or
 *   - `PostCode` on its own, which answers the nearest stores to that postcode
 *     with the postcode's own store first.
 */

export const STORE_LOCATOR_ENDPOINT = "https://www.woolworths.com.au/apis/ui/StoreLocator/Stores";

/** The website answers JSON to anything that asks politely. No key, no cookie. */
export const STORE_LOCATOR_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "User-Agent": "woolworths-catalogue/1.0",
};

/** Petrol and Big W come back on the same call, and neither sells dinner. */
const SUPERMARKETS = "SUPERMARKETS";

const DEFAULT_MAX = 10;

export interface StoreSearchResult {
  storeNumber: string;
  name: string;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  address: string | null;
}

interface RawStore {
  Division?: string | null;
  StoreNo?: string | number | null;
  Name?: string | null;
  AddressLine1?: string | null;
  Suburb?: string | null;
  State?: string | null;
  Postcode?: string | null;
}

/** Australian postcodes are four digits, and the call is worthless without one. */
export function isPostcode(value: string): boolean {
  return /^\d{4}$/.test(value.trim());
}

export function storeLocatorUrl(postcode: string, max: number = DEFAULT_MAX): string {
  const url = new URL(STORE_LOCATOR_ENDPOINT);
  url.searchParams.set("Max", String(max));
  url.searchParams.set("PostCode", postcode.trim());
  return url.toString();
}

/**
 * The stores worth showing, in the order the locator answered, which puts the
 * postcode's own store first. A row with no store number is dropped rather than
 * shown: it cannot be added, and a name with nothing behind it in a list of
 * shops is worse than one fewer line.
 */
export function mapStoreLocatorResponse(payload: unknown): StoreSearchResult[] {
  const stores = (payload as { Stores?: RawStore[] } | null)?.Stores ?? [];

  return stores
    .filter((store) => (store?.Division ?? SUPERMARKETS).trim().toUpperCase() === SUPERMARKETS)
    .map((store) => ({
      storeNumber: String(store?.StoreNo ?? "").trim(),
      name: store?.Name?.trim() ?? "",
      suburb: store?.Suburb?.trim() || null,
      state: store?.State?.trim() || null,
      postcode: store?.Postcode?.trim() || null,
      address: store?.AddressLine1?.trim() || null,
    }))
    .filter((store) => store.storeNumber.length > 0 && store.name.length > 0);
}

export interface StoreLocatorOptions {
  max?: number;
  fetchImpl?: typeof fetch;
}

export async function findStoresByPostcode(
  postcode: string,
  options: StoreLocatorOptions = {}
): Promise<StoreSearchResult[]> {
  if (!isPostcode(postcode)) {
    throw new Error(`"${postcode}" is not an Australian postcode.`);
  }

  const request = options.fetchImpl ?? fetch;
  const response = await request(storeLocatorUrl(postcode, options.max ?? DEFAULT_MAX), {
    method: "GET",
    headers: STORE_LOCATOR_HEADERS,
  });

  if (!response.ok) {
    throw new Error(
      `The Woolworths store locator answered HTTP ${response.status} for postcode ${postcode}.`
    );
  }

  return mapStoreLocatorResponse(await response.json());
}
