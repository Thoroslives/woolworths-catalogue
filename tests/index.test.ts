import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";

describe("the public surface", () => {
  it("exports the four reads, the sweep, the search and the parsers", () => {
    const names = [
      "findStoresByPostcode", "fetchProduct", "fetchProductWithShelf", "fetchCategoryProducts",
      "sweepStore", "searchEntries", "parseCatalogueEntry", "allLeafCategories", "findCategoryByPath",
    ] as const;
    for (const name of names) {
      expect(typeof api[name], name).toBe("function");
    }
  });
});
