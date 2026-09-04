/**
 * The public surface. Import from here and nothing else moves under you.
 * Everything not listed is an implementation detail and may change.
 *
 *   import { findStoresByPostcode, fetchProduct, sweepStore, searchEntries } from "woolworths-catalogue";
 */

export { findStoresByPostcode, isPostcode } from "./storeLocator.js";
export type { StoreLocatorOptions, StoreSearchResult } from "./storeLocator.js";

export {
  fetchCategoryProducts,
  fetchProduct,
  fetchProductWithShelf,
  WoolworthsDegradedError,
  WoolworthsEmptyFeedError,
} from "./client.js";
export type { WoolworthsRequestOptions } from "./client.js";
export type { CategoryPath } from "./productMapper.js";

export { sweepStore } from "./catalogue.js";
export type { SweepCallbacks, SweepOptions, SweepSummary } from "./catalogue.js";

export { parseCatalogueEntry } from "./catalogueTypes.js";
export type { CatalogueEntry } from "./catalogueTypes.js";

export { dedupeByStoreAndStockcode, searchEntries } from "./search.js";

export {
  allLeafCategories,
  departmentCategories,
  findCategoryById,
  findCategoryByPath,
  foodDepartmentCategories,
  foodLeafCategories,
} from "./categories.js";
export type { LeafCategory } from "./categories.js";

export { parsePackSize } from "./packSize.js";
export { normaliseStockcode } from "./productMapper.js";
export type { Macros, ProductNutrition } from "./nutrition.js";
export type { PackSize, PackUnit, ProductAvailability, ProductLocation, ProductRow } from "./types.js";
