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

/**
 * What the shelf tag says about this price beyond the price itself.
 *
 * Three different things arrive through one pair of fields, and only one of
 * them is a special. Sampled over 108 products in five categories at one store
 * on 2026-09-06: 47 `LOW_PRICE`, 37 carrying nothing, 16 `LOWER_SHELF_PRICE`,
 * 8 `SPECIAL`.
 *
 *   - `SPECIAL` is a real, temporary special, and the label states the saving
 *     outright: "SAVE $0.70".
 *   - `LOWER_SHELF_PRICE` is a permanent drop. The was-price carries the date
 *     it dropped, and it is not going back up, so it is not something to hurry
 *     for.
 *   - `LOW_PRICE` is "EVERYDAY LOW PRICE" and nothing changed at all. It
 *     carries no was-price.
 *
 * Treating all three as one would mark two thirds of a shop.
 */
export interface ProductPromotion {
  /**
   * The tag verbatim: "Was $7.00", "Was $10.50 05/03/2026",
   * "Range was $7.90 14/04/2026".
   *
   * Kept beside the parsed number for the same reason `packDisplay` is kept
   * beside `packAmount`. "Range was" is the range's old price rather than this
   * product's own, and a bare number cannot say so.
   */
  wasPriceDisplay: string | null;
  /**
   * Dollars, read out of that text.
   *
   * **Unlike `price`, the wire gives this one in dollars already**, inside a
   * formatted string. Dividing it by a hundred the way `price` is divided
   * turns seven dollars into seven cents.
   */
  wasPrice: number | null;
  /** "SPECIAL", "LOWER_SHELF_PRICE", "LOW_PRICE". */
  promotionType: string | null;
  /** "SAVE $0.70", "LOWER SHELF PRICE", "EVERYDAY LOW PRICE". */
  promotionLabel: string | null;
}

/**
 * What a multibuy prints beside the ordinary shelf price.
 *
 * Both fields are ready-made display strings in dollars, not cents and not
 * numbers, so they are carried through exactly as the wire writes them. There
 * is deliberately no quantity here: the wire has no quantity field, and the
 * count exists only inside `multiBuyPrice` for the consumer to interpret.
 */
export interface ProductMultiBuy {
  /** The complete deal: "2 for $8.00". */
  multiBuyPrice: string | null;
  /** The deal's printed rate: "$1.07 per 100G". */
  multiBuyUnitPrice: string | null;
}

export interface ProductLocation {
  locationText: string | null;
  locationZone: string | null;
  aisleNumber: number | null;
  aisleSide: string | null;
  bayNumber: number | null;
}

export interface ProductRow extends PackSize, ProductLocation, ProductPromotion, ProductMultiBuy {
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
