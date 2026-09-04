/**
 * The Woolworths category tree, cached in the repository because it is national
 * and it barely moves.
 *
 * `productCategories` on the mobile gateway takes no store number, so the ids
 * below are the same in Melbourne and in Sydney. Only the products inside a
 * category are store scoped. That is what makes the tree safe to commit and the
 * product index not.
 *
 * The tree is walked three levels deep and only the leaves are kept, because a
 * leaf is the only thing `productsByCategory` answers usefully. 1475 leaves, of
 * which 548 sit under a food department.
 *
 * Refresh it by walking `productCategories` on the gateway again. Nothing reads it at runtime
 * except the sweep, so a stale tree costs a missing shelf and never a wrong
 * price.
 */

import taxonomy from "../data/category-taxonomy.json" with { type: "json" };

export interface LeafCategory {
  /** "1_2DDBF53". Opaque, national, and the only thing the gateway accepts. */
  categoryId: string;
  level1: string;
  level2: string;
  level3: string;
  /**
   * Whether the department is one that sells food. The sweep
   * uses it to skip Electronics and Home & Lifestyle, which together are a
   * third of the tree and hold nothing anybody eats.
   */
  isFood: boolean;
}

interface TaxonomyFile {
  source: string;
  note: string;
  categories: LeafCategory[];
}

const FILE = taxonomy as TaxonomyFile;

export function allLeafCategories(): LeafCategory[] {
  return FILE.categories;
}

export function foodLeafCategories(): LeafCategory[] {
  return FILE.categories.filter((category) => category.isFood);
}

/**
 * One category per department: the fast sweep, and an incomplete one.
 *
 * Woolworths' menu carries an "All <Department>" node whose id is the
 * department's own, so `Bakery / All Bakery / All Bakery` is `1_DEB537E`, the
 * level one Bakery id, and reading it returns most of the department in a
 * fraction of the calls.
 *
 * **It does not return all of it, and two departments checked was not enough to
 * know that.** Bakery agreed exactly, 491 against 491, and so did Dairy, Eggs &
 * Fridge at 1,262. Across the whole shop at one store on 2026-08-03 the 25
 * department nodes returned 28,882 distinct products and the 1,475 leaves
 * returned 31,627. The 2,745 the departments missed are all Home & Lifestyle,
 * Electronics and Cleaning & Maintenance: greeting cards, magazines and SIM
 * packs.
 *
 * So this is the seven minute sweep for somebody who wants food and is content
 * to miss stationery. `allLeafCategories` is the twenty eight minute one that
 * misses nothing, and it is the default.
 */
export function departmentCategories(): LeafCategory[] {
  return FILE.categories.filter(
    (category) => category.level2.startsWith("All ") && category.level3.startsWith("All ")
  );
}

/**
 * The twelve departments that sell food.
 *
 * **Narrower than it looks, and it misses food.** Twenty four products that
 * label themselves into a food department are only reachable through another
 * department's leaves, and they are not obscure: Macro Chia Black 350g, Macro
 * Hemp Seeds 200g, Macro Organic Brown Flaxseed Meal 500g, Macro LSA, quinoa
 * and couscous. Chia and flaxseed are ordinary pantry lines, so this sweep
 * misses real food and it stays only because it is the quickest way to look
 * at one shop.
 */
export function foodDepartmentCategories(): LeafCategory[] {
  return departmentCategories().filter((category) => category.isFood);
}

export function findCategoryById(categoryId: string): LeafCategory | null {
  return FILE.categories.find((category) => category.categoryId === categoryId) ?? null;
}

/**
 * The leaf a product's own card names, resolved to an id.
 *
 * A `ProductCard` carries its three level path as names and never as ids, so
 * this is the only way back from a product to the shelf it came off. The match
 * is on the level three name and the level one name together, because
 * "Vegetarian & Meat Free" is unique and plenty of level three names are not.
 */
export function findCategoryByPath(level1: string, level3: string): LeafCategory | null {
  const wanted1 = level1.trim().toLowerCase();
  const wanted3 = level3.trim().toLowerCase();

  return (
    FILE.categories.find(
      (category) =>
        category.level1.toLowerCase() === wanted1 &&
        category.level3.toLowerCase() === wanted3
    ) ?? null
  );
}
