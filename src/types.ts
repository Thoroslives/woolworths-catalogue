/**
 * What one Woolworths store answered about one stockcode. Everything here is
 * store scoped: price, stock and shelf all differ between Melbourne and Sydney
 * on the same product.
 */

import { ProductNutrition } from "./nutrition.js";

export type { ProductNutrition };

export type PackUnit = "g" | "ml" | "count";

/**
 * Three of these mean the store ranges the product and one does not.
 * `unavailable` is a shelf that is empty today; `not_ranged` is a shelf that
 * never holds it, which sends a shopper to the wrong end of the store if the
 * two are confused. `see_in_store` is the store selling it and declining to say
 * which shelf, which is still a line worth walking in for.
 */
export type ProductAvailability = "in_stock" | "unavailable" | "see_in_store" | "not_ranged";

export interface PackSize {
  /** The part of the name a person reads as the pack: "450g", "12 Pack". */
  packDisplay: string | null;
  packAmount: number | null;
  packUnit: PackUnit | null;
}

export interface ProductLocation {
  locationText: string | null;
  locationZone: string | null;
  aisleNumber: number | null;
  aisleSide: string | null;
  bayNumber: number | null;
}

export interface ProductRow extends PackSize, ProductLocation {
  stockcode: string;
  storeNumber: string;
  name: string;
  /** Dollars. The wire carries cents, and the mapper is where that is undone. */
  price: number | null;
  /** "$6.22 per 1kg", as the shelf label reads it. */
  unitPriceDescription: string | null;
  availability: ProductAvailability;
  isRanged: boolean;
  /**
   * The panel, or null on a product that has none. Fresh produce and
   * non-food lines carry no panel at all, so a null here is honest rather
   * than broken.
   *
   * **It is never a zero.** A manufacturer who declared nothing and a food
   * that carries nothing are not the same fact, so a panel declaring zero of
   * everything on a solid food is treated as absent rather than as zero.
   */
  nutrition: ProductNutrition | null;
}
