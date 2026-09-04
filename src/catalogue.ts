import { fetchWoolworths } from "./client.js";
import { foodLeafCategories, type LeafCategory } from "./categories.js";
import { PRODUCTS_BY_CATEGORY_QUERY } from "./queries.js";
import type { CatalogueEntry } from "./catalogueTypes.js";

/**
 * Walking one store's catalogue, page by page, into whatever the caller keeps.
 *
 * The reason this exists rather than a search call: the app's own search,
 * `productList`, refuses an anonymous caller with `BAD_USER_INPUT`, and the
 * website search that this project used instead is national and demonstrably misses
 * stock. `productsByCategory` is the one read that answers anonymously *and*
 * takes a store number, so the catalogue is assembled from it, one leaf
 * category at a time.
 *
 * Cost, measured at one store on 2026-08-03: all 1,475 leaf categories, 130,508
 * rows carrying 31,627 distinct products, twenty eight minutes. Small enough to
 * run daily and far too slow to put behind a keystroke, which is the point.
 *
 * The rows are four times the products because one product sits on many shelves.
 * The upsert is keyed on the store and the stockcode, so that is wasted writes
 * and never a duplicate row.
 *
 * Reading one "All <Department>" node per department instead takes seven minutes
 * and misses 2,745 products. See `departmentCategories`, which carries the
 * numbers and the reason it is not the default.
 */

/** What one page asks for. The gateway caps well above this and 36 is its own default. */
const PAGE_SIZE = 36;

/**
 * How many pages one category may spend before the sweep moves on.
 *
 * A guard against a category that keeps answering `nextPage` for ever, not a
 * coverage decision: the largest food leaf measured holds a few thousand
 * products, so this is roughly thirty times the worst real case. When it does
 * bite, the sweep says so rather than pretending the category is finished.
 */
const MAX_PAGES_PER_CATEGORY = 400;

interface RawCard {
  __typename?: string;
  productId?: string | null;
  name?: string | null;
  price?: number | null;
  isAvailable?: boolean | null;
  unitPriceDescription?: string | null;
  inStoreDetails?: { locationText?: string | null } | null;
  categories?: { name?: string | null; categoryLevel?: number | null }[] | null;
}

interface RawCategoryPage {
  totalNumberOfProducts?: number | null;
  nextPage?: number | null;
  productsFeed?: RawCard[] | null;
}

export interface CategoryPage {
  entries: CatalogueEntry[];
  total: number;
  nextPage: number | null;
}

/**
 * One page of a category read, turned into rows.
 *
 * The feed is a union and it carries banners and ad containers beside products,
 * so anything that is not a `ProductCard` is dropped rather than mapped. A card
 * without a stockcode or a name is dropped too: it cannot be found again and
 * it cannot be searched, so writing it would only pad the file.
 *
 * Price arrives in cents and is null whenever the store cannot sell it today.
 * Null is carried through as null, because a zero here would read as free.
 */
export function mapCategoryPage(
  payload: unknown,
  storeNumber: string,
  category: LeafCategory
): CategoryPage {
  const page = (payload as { data?: { productsByCategory?: RawCategoryPage | null } | null } | null)
    ?.data?.productsByCategory;

  const entries: CatalogueEntry[] = [];

  for (const card of page?.productsFeed ?? []) {
    if (card?.__typename !== "ProductCard") {
      continue;
    }

    const stockcode = String(card.productId ?? "").trim().replace(/^0+/, "");
    const name = card.name?.trim() ?? "";
    if (!stockcode || !name) {
      continue;
    }

    const path = card.categories ?? [];
    const atLevel = (level: number) =>
      path.find((item) => item?.categoryLevel === level)?.name?.trim() || null;

    entries.push({
      storeNumber,
      stockcode,
      name,
      price: typeof card.price === "number" ? card.price / 100 : null,
      isAvailable: card.isAvailable === true,
      unitPriceDescription: card.unitPriceDescription?.trim() || null,
      categoryId: category.categoryId,
      categoryLevel1: atLevel(1) ?? category.level1,
      categoryLevel2: atLevel(2) ?? category.level2,
      categoryLevel3: atLevel(3) ?? category.level3,
      locationText: card.inStoreDetails?.locationText?.trim() || null,
    });
  }

  return {
    entries,
    total: page?.totalNumberOfProducts ?? 0,
    nextPage: page?.nextPage ?? null,
  };
}

export interface SweepCallbacks {
  /** Called once per category with everything that category held. */
  onCategory: (category: LeafCategory, entries: CatalogueEntry[]) => Promise<void>;
  /** Called after each category so a long sweep can be watched. */
  onProgress?: (done: number, total: number, written: number) => void;
}

export interface SweepOptions {
  categories?: LeafCategory[];
  fetchImpl?: typeof fetch;
}

export interface SweepSummary {
  categoriesDone: number;
  categoriesTotal: number;
  productsWritten: number;
  /** Categories the page guard cut short, named so a gap is never silent. */
  truncated: string[];
}

/**
 * Read every leaf category at one store and hand each page to the caller.
 *
 * This does not touch the database. The caller decides what a page means, which
 * is what lets the same walk serve a full sweep and a dry run that only
 * counts.
 *
 * A category that throws stops the sweep. A partial index is worth keeping and
 * the sweep row records that it is partial, so the alternative, swallowing the
 * error and reporting a complete index over half a shop, is the one outcome
 * that this design exists to prevent.
 */
export async function sweepStore(
  storeNumber: string,
  callbacks: SweepCallbacks,
  options: SweepOptions = {}
): Promise<SweepSummary> {
  const categories = options.categories ?? foodLeafCategories();
  const truncated: string[] = [];
  let written = 0;
  let done = 0;

  for (const category of categories) {
    const entries: CatalogueEntry[] = [];
    let pageNumber: number | null = 1;
    let pages = 0;

    while (pageNumber !== null && pages < MAX_PAGES_PER_CATEGORY) {
      const payload = await fetchWoolworths(
        PRODUCTS_BY_CATEGORY_QUERY,
        {
          categoryId: category.categoryId,
          storeId: storeNumber,
          pageSize: PAGE_SIZE,
          pageNumber,
        },
        { fetchImpl: options.fetchImpl }
      );

      const page = mapCategoryPage(payload, storeNumber, category);
      entries.push(...page.entries);
      pageNumber = page.nextPage;
      pages += 1;
    }

    if (pageNumber !== null) {
      truncated.push(`${category.level1} / ${category.level3}`);
    }

    await callbacks.onCategory(category, entries);
    written += entries.length;
    done += 1;
    callbacks.onProgress?.(done, categories.length, written);
  }

  return {
    categoriesDone: done,
    categoriesTotal: categories.length,
    productsWritten: written,
    truncated,
  };
}
