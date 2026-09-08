import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RawProductCard,
  mapProductByStockcode,
  mapProductCard,
  mapProductsByCategory,
} from "../src/productMapper.js";
import { mapCategoryPage } from "../src/catalogue.js";
import { findCategoryById } from "../src/categories.js";

// Recorded payloads only. products.test.ts holds the check that keeps every
// test file off the live gateway, and it reads this file too.

const FIXTURES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "fixtures"
);

function fixture(name: string) {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, `${name}.json`), "utf8"));
}

type CategoryPage = { data: { productsByCategory: { productsFeed: RawProductCard[] } } };

function cardOf(page: CategoryPage, stockcode: string): RawProductCard {
  const card = page.data.productsByCategory.productsFeed.find((product) =>
    String(product.productId).endsWith(stockcode)
  );
  if (!card) throw new Error(`no card ends in ${stockcode}`);
  return card;
}

/** Recorded at store 7220 on 2026-09-07 with the gateway's complete shape. */
describe("the multibuy printed on a product card", () => {
  const MULTIBUY_STORE = "7220";

  it("carries both deal strings through verbatim", () => {
    const rows = mapProductsByCategory(
      fixture("category-single-meals-multibuy"),
      MULTIBUY_STORE
    );
    const lasagne = rows.find((row) => row.stockcode === "388386");

    expect(lasagne).toMatchObject({
      multiBuyPrice: "2 for $8.00",
      multiBuyUnitPrice: "$1.07 per 100G",
    });
  });

  it("maps both strings to null when the card carries no deal", () => {
    const rows = mapProductsByCategory(
      fixture("category-single-meals-multibuy"),
      MULTIBUY_STORE
    );
    const bolognese = rows.find((row) => row.stockcode === "544364");

    expect(bolognese).toMatchObject({
      multiBuyPrice: null,
      multiBuyUnitPrice: null,
    });
  });

  it("keeps the deal when its unit price is absent", () => {
    const page = structuredClone(fixture("category-single-meals-multibuy")) as CategoryPage;
    delete cardOf(page, "388386").multiBuyPriceInfo?.unitPrice;

    const lasagne = mapProductsByCategory(page, MULTIBUY_STORE).find(
      (row) => row.stockcode === "388386"
    );
    expect(lasagne).toMatchObject({
      multiBuyPrice: "2 for $8.00",
      multiBuyUnitPrice: null,
    });
  });

  it("reads a promotion and a deal on the same card independently", () => {
    // No recording holds both at once, so one card on the page is given a
    // special beside the deal it already carries.
    const page = structuredClone(fixture("category-single-meals-multibuy")) as CategoryPage;
    const card = cardOf(page, "388386");
    card.wasPrice = "Was $4.50";
    card.promotionInfo = { type: "SPECIAL", label: "SAVE $0.30" };

    const lasagne = mapProductsByCategory(page, MULTIBUY_STORE).find(
      (row) => row.stockcode === "388386"
    );
    expect(lasagne).toMatchObject({
      wasPrice: 4.5,
      promotionType: "SPECIAL",
      promotionLabel: "SAVE $0.30",
      multiBuyPrice: "2 for $8.00",
      multiBuyUnitPrice: "$1.07 per 100G",
    });
  });

  it("maps a missing multibuy key to null beside a promotion", () => {
    // Recorded before the query asked for the field, so the key is absent
    // rather than null.
    const rows = mapProductsByCategory(fixture("category-cheese-promotions"), MULTIBUY_STORE);
    const shredded = rows.find((row) => row.stockcode === "491820");

    expect(shredded).toMatchObject({
      promotionType: "LOWER_SHELF_PRICE",
      promotionLabel: "LOWER SHELF PRICE",
      multiBuyPrice: null,
      multiBuyUnitPrice: null,
    });
  });

  it("maps blank multibuy strings to null and trims the rest", () => {
    const blank = mapProductCard(
      { multiBuyPriceInfo: { price: "   ", unitPrice: "" } } as RawProductCard,
      MULTIBUY_STORE
    );
    expect(blank).toMatchObject({ multiBuyPrice: null, multiBuyUnitPrice: null });

    const padded = mapProductCard(
      { multiBuyPriceInfo: { price: " 2 for $8.00 ", unitPrice: " $1.07 per 100G " } } as RawProductCard,
      MULTIBUY_STORE
    );
    expect(padded).toMatchObject({
      multiBuyPrice: "2 for $8.00",
      multiBuyUnitPrice: "$1.07 per 100G",
    });
  });

  it("includes both null keys when no product card was returned", () => {
    const row = mapProductByStockcode(
      { data: { productDetails: { feed: [] } } },
      "388386",
      MULTIBUY_STORE
    );

    expect(row).toMatchObject({
      multiBuyPrice: null,
      multiBuyUnitPrice: null,
    });
  });

  it("carries the deal onto the sweep row, beside the promotion", () => {
    const singleMeals = findCategoryById("1_B5E7442");
    expect(singleMeals).not.toBeNull();
    const page = mapCategoryPage(
      fixture("category-single-meals-multibuy"),
      MULTIBUY_STORE,
      singleMeals!
    );

    const lasagne = page.entries.find((entry) => entry.stockcode === "388386");
    expect(lasagne).toMatchObject({
      promotionType: null,
      multiBuyPrice: "2 for $8.00",
      multiBuyUnitPrice: "$1.07 per 100G",
    });
    expect(page.entries.filter((entry) => entry.multiBuyPrice !== null)).toHaveLength(4);
  });
});
