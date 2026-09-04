/**
 * One row per product one shop ranges, as the sweep reads it off a category
 * page. Deliberately thinner than `ProductRow`: a category page shows what a
 * shopper chooses between and nothing else. Aisle, bay, pack size and the
 * nutrition panel are read one product at a time by `fetchProduct`, because
 * they are worth a call each and only for the product somebody chose.
 */

export interface CatalogueEntry {
  storeNumber: string;
  stockcode: string;
  /** "Beyond Meat Beyond Burger Plant Based Patties 226g 2 Pack". */
  name: string;
  /** Dollars, or null when the store cannot sell it today. Never a zero. */
  price: number | null;
  isAvailable: boolean;
  /**
   * The shelf rate: "$6.22 per 1kg", "$3.40 each". It is the one field that
   * says whether a product is counted or weighed, and beside two identical
   * names it is the difference between $1.38 the avocado and $29 the kilo.
   */
  unitPriceDescription: string | null;
  categoryId: string;
  categoryLevel1: string | null;
  categoryLevel2: string | null;
  categoryLevel3: string | null;
  /** "Dairy", "Aisle 3". The coarse hint, not the aisle and bay. */
  locationText: string | null;
}

/**
 * One line of a sweep file, checked at the boundary. A truncated last line or
 * a file from an older shape fails here, by name, rather than somewhere in a
 * sort comparator.
 */
export function parseCatalogueEntry(value: unknown): CatalogueEntry {
  if (typeof value !== "object" || value === null) {
    throw new Error("A sweep line is not an object.");
  }
  const row = value as Record<string, unknown>;
  const text = (key: string): string => {
    const field = row[key];
    if (typeof field !== "string" || field === "") throw new Error(`Sweep line has no ${key}.`);
    return field;
  };
  const textOrNull = (key: string): string | null => {
    const field = row[key];
    return typeof field === "string" ? field : null;
  };
  const storeNumber = text("storeNumber");
  const stockcode = text("stockcode");
  const name = text("name");
  const price = row.price;
  if (price !== null && typeof price !== "number") throw new Error("Sweep line price is not a number or null.");
  if (typeof row.isAvailable !== "boolean") throw new Error("Sweep line has no isAvailable.");
  return {
    storeNumber,
    stockcode,
    name,
    price,
    isAvailable: row.isAvailable,
    unitPriceDescription: textOrNull("unitPriceDescription"),
    categoryId: text("categoryId"),
    categoryLevel1: textOrNull("categoryLevel1"),
    categoryLevel2: textOrNull("categoryLevel2"),
    categoryLevel3: textOrNull("categoryLevel3"),
    locationText: textOrNull("locationText"),
  };
}
