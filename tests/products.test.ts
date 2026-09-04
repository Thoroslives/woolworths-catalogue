import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isDegradedResponse, unrequestedKeys } from "../src/degraded.js";
import { mapNutrition, readAmount } from "../src/nutrition.js";
import { parsePackSize } from "../src/packSize.js";
import {
  RawProductCard,
  mapProductByStockcode,
  mapProductCard,
  mapProductCategoryPath,
  mapProductsByCategory,
  normaliseStockcode,
  readCategoryPath,
  readPrice,
} from "../src/productMapper.js";
import { mapCategoryPage } from "../src/catalogue.js";
import {
  allLeafCategories,
  findCategoryById,
  findCategoryByPath,
  departmentCategories,
  foodDepartmentCategories,
  foodLeafCategories,
} from "../src/categories.js";
import { PRODUCTS_BY_CATEGORY_QUERY, PRODUCT_DETAILS_QUERY } from "../src/queries.js";
import {
  isPostcode,
  mapStoreLocatorResponse,
  storeLocatorUrl,
} from "../src/storeLocator.js";

// Recorded payloads only, every one of them written by the smoke script against
// one store and a control store in Sydney. Nothing here reaches the shop, and the
// last describe in this file is what keeps that true.

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(TESTS_DIR, "..", "data", "fixtures");

// The store the details and category fixtures were recorded at.
const RECORDED_STORE = "7219";
const SYDNEY = "1248";

function fixture(name: string) {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, `${name}.json`), "utf8"));
}

describe("the degraded detector", () => {
  it("catches the canned payload on a call that asked for something else", () => {
    const degraded = fixture("degraded-response");

    expect(isDegradedResponse(PRODUCT_DETAILS_QUERY, degraded.data)).toBe(true);
    expect(unrequestedKeys(PRODUCT_DETAILS_QUERY, degraded.data)).toContain("sortOptions");
  });

  it("catches it on a call that legitimately asks for productsByCategory", () => {
    // The operation name cannot separate these two, because this is the answer
    // to the very question the canned payload pretends to answer. The keys can:
    // a real answer carries the selection set and nothing else.
    const degraded = fixture("degraded-response");

    expect(isDegradedResponse(PRODUCTS_BY_CATEGORY_QUERY, degraded.data)).toBe(true);
    expect(unrequestedKeys(PRODUCTS_BY_CATEGORY_QUERY, degraded.data)).toEqual(
      expect.arrayContaining(["analytics", "filters", "marketplaceFilterSwitch", "sortOptions"])
    );
  });

  it("lets a product the store does not range through", () => {
    // This call answers with a card for every stockcode, including one the
    // store has never carried, so a not-ranged answer is a real answer and
    // retrying it forever would make it unreachable.
    expect(isDegradedResponse(PRODUCT_DETAILS_QUERY, fixture("details-not-ranged").data)).toBe(
      false
    );
  });

  it("lets every recorded response through", () => {
    const cases: Array<[string, string]> = [
      ["details-in-stock-perimeter", PRODUCT_DETAILS_QUERY],
      ["details-centre-of-store", PRODUCT_DETAILS_QUERY],
      ["details-ranged-unavailable", PRODUCT_DETAILS_QUERY],
      ["details-see-in-store", PRODUCT_DETAILS_QUERY],
      ["details-produce", PRODUCT_DETAILS_QUERY],
      ["details-countable-pack", PRODUCT_DETAILS_QUERY],
      ["details-not-ranged-control-1248", PRODUCT_DETAILS_QUERY],
      ["details-not-ranged", PRODUCT_DETAILS_QUERY],
      ["details-bad-serving-column", PRODUCT_DETAILS_QUERY],
      ["details-never-carried", PRODUCT_DETAILS_QUERY],
      ["category-vegetarian-five", PRODUCTS_BY_CATEGORY_QUERY],
    ];

    for (const [name, query] of cases) {
      expect(unrequestedKeys(query, fixture(name).data), name).toEqual([]);
    }
  });

  it("does not read __typename as a key nobody asked for", () => {
    expect(isDegradedResponse("query { a { b } }", { a: { __typename: "A", b: 1 } })).toBe(false);
  });
});

describe("parsePackSize", () => {
  it("parses a mass to grams and a volume to millilitres", () => {
    expect(parsePackSize("Macro Firm Tofu 450g")).toEqual({
      packDisplay: "450g",
      packAmount: 450,
      packUnit: "g",
    });
    expect(parsePackSize("Banana 1kg")).toMatchObject({ packAmount: 1000, packUnit: "g" });
    expect(parsePackSize("Oat-ly! Organic Oat Cream 250ml")).toMatchObject({
      packAmount: 250,
      packUnit: "ml",
    });
    expect(parsePackSize("Coca-Cola Classic Soft Drink 1.25L")).toMatchObject({
      packAmount: 1250,
      packUnit: "ml",
    });
  });

  it("parses a countable pack to count rather than to a wrong gram figure", () => {
    // Twelve eggs are twelve of something. The 600g in the name is the weight
    // of the carton's contents, and a list that read it as the pack would buy
    // two dozen eggs where a hundred grams was wanted.
    expect(parsePackSize("Woolworths Large Free Range Eggs 600g 12 Pack")).toEqual({
      packDisplay: "12 Pack",
      packAmount: 12,
      packUnit: "count",
    });
    expect(parsePackSize("Banana Kids 5pk")).toMatchObject({ packAmount: 5, packUnit: "count" });
    expect(parsePackSize("Sorbent 3ply White Toilet Paper 40 pk")).toMatchObject({
      packAmount: 40,
      packUnit: "count",
    });
    expect(parsePackSize("Woolworths Truss Tomatoes Each")).toMatchObject({
      packAmount: 1,
      packUnit: "count",
    });
  });

  it("multiplies a multipack out, whichever way round it is written", () => {
    expect(parsePackSize("Sparkling Water 12x375mL")).toMatchObject({
      packAmount: 4500,
      packUnit: "ml",
    });
    expect(parsePackSize("Sparkling Water 375mL x 12")).toMatchObject({
      packAmount: 4500,
      packUnit: "ml",
    });
  });

  it("records three nulls for a name that carries no pack at all", () => {
    // The shelf is full of these, and none of them is worth a crash halfway
    // round the shop.
    expect(parsePackSize("D Card Tofu")).toEqual({
      packDisplay: null,
      packAmount: null,
      packUnit: null,
    });
    expect(parsePackSize(null)).toEqual({
      packDisplay: null,
      packAmount: null,
      packUnit: null,
    });
  });
});

describe("readPrice", () => {
  it("reads the wire's cents as dollars", () => {
    // 280 on a 450 g tofu is $2.80, which the card's own "$6.22 per 1kg" says
    // twice over. Left alone every price is a hundred times too dear.
    expect(readPrice(280)).toBe(2.8);
    expect(readPrice(1600)).toBe(16);
  });

  it("keeps a missing price missing", () => {
    expect(readPrice(null)).toBeNull();
    expect(readPrice(0)).toBeNull();
  });
});

describe("normaliseStockcode", () => {
  it("strips the padding the wire adds", () => {
    // A stockcode is written the way it is read off a shelf label. Stored
    // padded, a row could never be matched by one, and the same product could
    // sit in a file twice.
    expect(normaliseStockcode("000000000000023038")).toBe("23038");
    expect(normaliseStockcode("23038")).toBe("23038");
  });
});

describe("mapProductByStockcode", () => {
  it("reads a perimeter product on the shelf", () => {
    expect(mapProductByStockcode(fixture("details-in-stock-perimeter"), "23038", RECORDED_STORE)).toEqual({
      stockcode: "23038",
      storeNumber: RECORDED_STORE,
      name: "Macro Firm Tofu 450g",
      price: 2.8,
      unitPriceDescription: "$6.22 per 1kg",
      packDisplay: "450g",
      packAmount: 450,
      packUnit: "g",
      availability: "in_stock",
      isRanged: true,
      locationText: "Dairy",
      locationZone: "DAIRY",
      aisleNumber: 79,
      aisleSide: "left",
      bayNumber: 3,
      nutrition: expect.objectContaining({
        per100: { cal: 129.3, p: 14.8, c: 5.6, f: 3.9, fiber: 6.2 },
      }),
    });
  });

  it("reads a centre of store product down to the bay", () => {
    expect(mapProductByStockcode(fixture("details-centre-of-store"), "346830", RECORDED_STORE)).toMatchObject({
      name: "WW Pasta Spaghetti 500g",
      availability: "in_stock",
      locationText: "Aisle 6",
      locationZone: "CENTRE OF STORE",
      aisleNumber: 6,
      aisleSide: "right",
      bayNumber: 8,
    });
  });

  it("reads a ranged product that is off the shelf today", () => {
    // The shelf position is there and the price is not, which is the store
    // saying it stocks this and cannot sell it to you this morning.
    const row = mapProductByStockcode(fixture("details-ranged-unavailable"), "700638", RECORDED_STORE);

    expect(row).toMatchObject({
      name: "Macro Organic Chick Peas 425g",
      availability: "unavailable",
      isRanged: true,
      aisleNumber: 5,
      bayNumber: 7,
    });
    // Null is a price we do not have. It is never free.
    expect(row.price).toBeNull();
  });

  it("reads a ranged product the store will not place", () => {
    // The recorded store will sell this today at $16 and will not say which aisle it is
    // in. That is stock unknown, not a product it does not carry, and filing it
    // as unranged would strike a buyable line off the list.
    const row = mapProductByStockcode(fixture("details-see-in-store"), "6063933", RECORDED_STORE);

    expect(row).toMatchObject({
      availability: "see_in_store",
      isRanged: true,
      locationText: "See in store",
      price: 16,
    });
    expect(row.aisleNumber).toBeNull();
  });

  it("reads a card for a product the store has never carried", () => {
    // No shelf, no price, and the store does not offer it: Sydney does not
    // carry the Christmas roast. This is the case that must never come back
    // ranged, because a ranged line sends somebody looking for it. It carries a
    // nutrition panel all the same, which is why a panel is never read as proof
    // the store has it.
    expect(mapProductByStockcode(fixture("details-never-carried"), "114218", SYDNEY)).toMatchObject({
      stockcode: "114218",
      name: "Woolworths Plantitude Christmas Plant Based Roast Cranberry 500g",
      availability: "not_ranged",
      isRanged: false,
      price: null,
    });
  });

  it("keeps produce ranged even though it carries no shelf co-ordinates", () => {
    // Fresh produce has no aisle anywhere in the store and is plainly still
    // carried: the store gives a price, says it is available, and names the
    // department.
    const row = mapProductByStockcode(fixture("details-produce"), "133211", RECORDED_STORE);

    expect(row).toMatchObject({
      name: "Banana 1kg",
      availability: "in_stock",
      isRanged: true,
      locationText: "Produce Department",
      price: 4.9,
    });
    expect(row.aisleNumber).toBeNull();
  });

  it("records a stockcode the store never carries, and the same one at a store that does", () => {
    // The recorded store answers with a card carrying no shelf and no offer. Sydney's
    // carries both. Not ranged is per stockcode and per store, and the row says
    // so rather than going missing.
    const recorded = mapProductByStockcode(fixture("details-not-ranged"), "88186", RECORDED_STORE);
    const sydney = mapProductByStockcode(fixture("details-not-ranged-control-1248"), "88186", SYDNEY);

    expect(recorded).toMatchObject({
      stockcode: "88186",
      storeNumber: RECORDED_STORE,
      availability: "not_ranged",
      isRanged: false,
      price: null,
    });
    expect(sydney).toMatchObject({
      stockcode: "88186",
      storeNumber: SYDNEY,
      availability: "in_stock",
      isRanged: true,
      locationZone: "MEAT DEPARTMENT",
      aisleNumber: 91,
    });
  });

  it("counts a dozen eggs rather than weighing the name", () => {
    expect(mapProductByStockcode(fixture("details-countable-pack"), "582117", RECORDED_STORE)).toMatchObject({
      name: "Woolworths Large Free Range Eggs 600g 12 Pack",
      packDisplay: "12 Pack",
      packAmount: 12,
      packUnit: "count",
      price: 6.2,
    });
  });
});

describe("what marks a product as ranged", () => {
  const card = (extra: Partial<RawProductCard>): RawProductCard => ({
    productId: "000000000000812345",
    name: "Plantitude Christmas Plant Based Roast 500g",
    price: null,
    isAvailable: false,
    ...extra,
  });

  it("is inStoreLocation.details, not inStoreLocation being present", () => {
    // The object comes back either way. Testing the outer one marks a product
    // the store has never carried as ranged and sends somebody looking for it.
    expect(
      mapProductCard(
        card({
          inStoreDetails: { locationText: "See in store", locationType: "UNAVAILABLE" },
          inStoreLocation: { details: null },
        }),
        RECORDED_STORE
      )
    ).toMatchObject({ availability: "not_ranged", isRanged: false });

    expect(
      mapProductCard(
        card({
          inStoreDetails: { locationText: "Dairy", locationType: "AVAILABLE" },
          inStoreLocation: { details: { aisleNumber: 79, bayNumber: 3, location: "DAIRY" } },
        }),
        RECORDED_STORE
      )
    ).toMatchObject({ availability: "unavailable", isRanged: true });
  });

  it("does not fall back to ranged when the card says nothing either way", () => {
    // A card can arrive with no inStoreDetails block at all. Not carried is the
    // answer that costs a shopper nothing when it is wrong; ranged is the one
    // that walks them to an empty shelf.
    expect(mapProductCard(card({ inStoreLocation: { details: null } }), RECORDED_STORE)).toMatchObject({
      availability: "not_ranged",
      isRanged: false,
    });
    expect(mapProductCard(card({ inStoreDetails: null }), RECORDED_STORE)).toMatchObject({
      availability: "not_ranged",
      isRanged: false,
    });
    expect(mapProductCard(card({}), RECORDED_STORE)).toMatchObject({
      availability: "not_ranged",
      isRanged: false,
    });
  });

  it("keeps a located product ranged whatever the location type says", () => {
    // A shelf position is the store's own answer and it outranks everything
    // else on the card.
    expect(
      mapProductCard(
        card({
          isAvailable: true,
          inStoreDetails: { locationText: "See in store", locationType: "UNAVAILABLE" },
          inStoreLocation: { details: { aisleNumber: 5, bayNumber: 7, location: "CENTRE OF STORE" } },
        }),
        RECORDED_STORE
      )
    ).toMatchObject({ availability: "in_stock", isRanged: true });
  });
});

describe("mapProductsByCategory", () => {
  it("reads a whole category page at one store", () => {
    const rows = mapProductsByCategory(fixture("category-vegetarian-five"), RECORDED_STORE);

    expect(rows).toHaveLength(5);
    expect(rows.map((row) => [row.stockcode, row.availability, row.price])).toEqual([
      ["23038", "in_stock", 2.8],
      ["695083", "in_stock", 2.3],
      ["748944", "in_stock", 4.5],
      ["748945", "in_stock", 4.5],
      ["118215", "in_stock", 6.9],
    ]);
    expect(rows.every((row) => row.isRanged && row.locationZone === "DAIRY")).toBe(true);
  });
});

describe("the shelf an unsellable product came off", () => {
  // Candidate discovery, on a real case: Macro Plain Tempeh 88186,
  // which the recorded store does not carry. Every step below is a recording.

  it("reads the shelf off the product's own card, even though the store cannot sell it", () => {
    // The card comes back for a stockcode the store has never carried, and it
    // names the shelf all the same. That is the only route from a product back
    // to the aisle it belongs on.
    expect(mapProductCategoryPath(fixture("details-not-ranged"))).toEqual({
      level1: "Dairy, Eggs & Fridge",
      level2: "Vegetarian & Vegan",
      level3: "Vegetarian & Meat Free",
    });
  });

  it("resolves that shelf to the id the category read will take", () => {
    // The path arrives as names and the gateway only accepts ids.
    const shelf = mapProductCategoryPath(fixture("details-not-ranged"))!;

    expect(findCategoryByPath(shelf.level1!, shelf.level3!)?.categoryId).toBe("1_2DDBF53");
  });

  it("answers that shelf at the store with aisle, bay and the shelf price", () => {
    // The same category id, read at the recorded store: candidates that need no second call
    // to say where they are or what they cost.
    const rows = mapProductsByCategory(fixture("category-vegetarian"), RECORDED_STORE);

    expect(rows.length).toBeGreaterThan(10);
    expect(rows.find((row) => row.stockcode === "23038")).toMatchObject({
      name: "Macro Firm Tofu 450g",
      availability: "in_stock",
      isRanged: true,
      aisleNumber: 79,
      bayNumber: 3,
      price: 2.8,
    });
    // The panel does not ride this call, which is why a candidate worth ranking
    // is read again one at a time and why the cap is worth having.
    expect(rows.every((row) => row.nutrition === null)).toBe(true);
  });

  it("names no shelf rather than half a one", () => {
    // Only the outer two levels are matched on, and a payload with no card at
    // all is a shelf nobody can look up.
    expect(readCategoryPath({ categories: [{ name: "Dairy, Eggs & Fridge", categoryLevel: 1 }] })).toBeNull();
    expect(mapProductCategoryPath({ data: { productDetails: { feed: [] } } })).toBeNull();
  });
});

describe("the nutrition panel", () => {
  it("reads the per 100 column and not the per serving one", () => {
    // Macro Firm Tofu declares 22.2 g of protein a serving and 14.8 g per 100 g.
    // Both are true and only one of them scales, because the serving is
    // whatever the packet decided it was.
    const row = mapProductByStockcode(fixture("details-in-stock-perimeter"), "23038", RECORDED_STORE);

    expect(row.nutrition?.per100).toEqual({ cal: 129.3, p: 14.8, c: 5.6, f: 3.9, fiber: 6.2 });
    expect(row.nutrition?.perServing).toMatchObject({ p: 22.2, fiber: 9.3 });
  });

  it("finds the column by its heading rather than by its position", () => {
    const panel = mapNutrition({
      tableHeaderRow: [" ", "Quantity Per 100g / 100mL", "Quantity Per Serving"],
      tableRows: [["Protein", "14.8g", "22.2g"]],
    });

    expect(panel?.per100.p).toBe(14.8);
    expect(panel?.perServing?.p).toBe(22.2);
  });

  it("keeps a wrong serving size out of the numbers that scale", () => {
    // Woolworths' own data: a 200 g pack declaring a 2.0 g serving. The per
    // serving column puts this product last by a factor of fifty; the per 100 g
    // column puts it mid field, and the mid field figure is the true one.
    const row = mapProductByStockcode(fixture("details-bad-serving-column"), "748945", RECORDED_STORE);

    expect(row.nutrition?.servingSize).toBe("Serving size: 2.0 g");
    expect(row.nutrition?.perServing?.p).toBe(0.3);
    expect(row.nutrition?.per100.p).toBe(14.7);
  });

  it("converts the energy row from kilojoules to calories", () => {
    // The panel answers in kilojoules and Macros.cal is calories. Stored
    // unconverted, every plate reads four times its real energy.
    expect(mapNutrition({
      tableHeaderRow: [" ", "Quantity Per 100g"],
      tableRows: [["Energy", "541.0kJ"]],
    })?.per100.cal).toBe(129.3);
  });

  it("reads a limit of detection as the limit rather than as zero", () => {
    // "< 1.5g" is the honest ceiling. Reading it as zero flatters the product.
    expect(readAmount("< 1.5g")).toEqual({ value: 1.5, unit: "g" });
    expect(readAmount("22.2g")).toEqual({ value: 22.2, unit: "g" });
  });

  it("reads a dash as a figure the panel does not have", () => {
    expect(readAmount("-")).toBeNull();
    expect(readAmount("")).toBeNull();
  });

  it("reads energy that spells the calories out beside the kilojoules", () => {
    // Annalisa Butter Beans 400g writes energy this way and Macro Firm Tofu
    // 450g does not, so the two spellings have to land on the same number.
    // This cell used to match nothing and read as absent, which gave those
    // beans protein, carbohydrate and fibre and no calories, and a panel with
    // no calories looks finished rather than broken.
    expect(readAmount("547.4kJ(130.8Cal)")).toEqual({ value: 547.4, unit: "kj" });
    expect(readAmount("656.9kJ(156.9Cal)")).toEqual({ value: 656.9, unit: "kj" });

    expect(mapNutrition({
      tableHeaderRow: [" ", "Quantity Per 100g"],
      tableRows: [["Energy", "547.4kJ(130.8Cal)"]],
    })?.per100.cal).toBe(130.8);
  });

  it("reads a panel that hedges its own figures", () => {
    // Red Island Extra Virgin Olive Oil 1L writes every cell this way. Read as
    // absent it made an oil that is 91.5 g of fat per 100 mL contribute nothing
    // to anything made with it, which is the worst possible line to lose, because oil is almost entirely the thing being counted.
    expect(readAmount("Approx. 3446kJ")).toEqual({ value: 3446, unit: "kj" });
    expect(readAmount("Approx. 91.5g")).toEqual({ value: 91.5, unit: "g" });
    expect(readAmount("Approx. 0g")).toEqual({ value: 0, unit: "g" });
  });

  it("strips a qualifier stack rather than only the outermost one", () => {
    // Nothing says a panel cannot hedge and bound the same figure.
    expect(readAmount("< Approx. 1.5g")).toEqual({ value: 1.5, unit: "g" });
    expect(readAmount("Approx. < 1.5g")).toEqual({ value: 1.5, unit: "g" });
  });

  it("does not merge an indented row into the one above it", () => {
    // "Fat, Total" and "- Saturated" are two rows, and only the first is the
    // fat this app means.
    const panel = mapNutrition({
      tableHeaderRow: [" ", "Quantity Per 100g"],
      tableRows: [["Fat, Total", "3.9g"], ["– Saturated", "1.0g"]],
    });

    expect(panel?.per100.f).toBe(3.9);
  });

  it("records no panel for a product that has none", () => {
    // Fresh produce carries no panel and neither does toilet paper. That is an
    // answer rather than a gap, so it is never retried and never read as zero.
    expect(mapProductByStockcode(fixture("details-produce"), "133211", RECORDED_STORE).nutrition).toBeNull();
    expect(
      mapProductByStockcode(fixture("details-see-in-store"), "6063933", RECORDED_STORE).nutrition
    ).toBeNull();
  });

  it("carries a panel on a product the store does not range", () => {
    // A panel is a fact about the product, not about this shop's shelves, so it
    // is never read as proof the store has it.
    const row = mapProductByStockcode(fixture("details-not-ranged"), "88186", RECORDED_STORE);

    expect(row.availability).toBe("not_ranged");
    expect(row.nutrition?.per100.p).toBeGreaterThan(0);
  });
});

describe("what the gateway will not serve", () => {
  // The batched read is refused to an anonymous caller. That is a claim about
  // somebody else's server, so it is pinned by a recording here rather than
  // left as prose.

  it("refuses the batched read outright", () => {
    expect(fixture("products-by-product-ids-refused").errors[0].extensions.code).toBe(
      "BAD_USER_INPUT"
    );
  });
});

describe("the store locator", () => {
  // The website's own, and the only proven route from a postcode to a store
  // number. Recorded with the smoke script against 3000.

  it("asks by postcode and by nothing else", () => {
    // Latitude and Longitude sent empty beside a Name is answered HTTP 400,
    // measured. PostCode on its own is answered.
    const url = storeLocatorUrl("3000");

    expect(url).toContain("PostCode=3000");
    expect(url).not.toContain("Latitude");
    expect(url).not.toContain("Name=");
  });

  it("answers the postcode's own store first", () => {
    const stores = mapStoreLocatorResponse(fixture("store-locator-3000"));

    expect(stores[0]).toEqual({
      storeNumber: "3304",
      name: "Qv",
      suburb: "Melbourne",
      state: "VIC",
      postcode: "3000",
      address: "Cnr Lonsdale and Swanston Streets",
    });
    expect(stores.length).toBeGreaterThan(1);
  });

  it("drops a row that cannot be added and one that does not sell dinner", () => {
    const stores = mapStoreLocatorResponse({
      Stores: [
        { Division: "SUPERMARKETS", StoreNo: "1000", Name: "Supermarket" },
        { Division: "PETROL", StoreNo: "1234", Name: "Supermarket Petrol" },
        { Division: "SUPERMARKETS", StoreNo: "", Name: "Nowhere" },
        { Division: "SUPERMARKETS", StoreNo: "4321", Name: "" },
      ],
    });

    expect(stores.map((store) => store.storeNumber)).toEqual(["1000"]);
  });

  it("refuses anything that is not an Australian postcode", () => {
    expect(isPostcode("3000")).toBe(true);
    expect(isPostcode(" 3000 ")).toBe(true);
    expect(isPostcode("730")).toBe(false);
    expect(isPostcode("Melbourne")).toBe(false);
  });
});

describe("the website search this repository stopped trusting", () => {

  it("shows the website search answering dog chews, and proves nothing wider", () => {
    // This fixture is kept as evidence and it is no longer read as a fact about
    // the catalogue. It records one national search answering two Bark & Beyond
    // dog chews for "beyond meat". That is all it ever showed. The conclusion
    // written on top of it, that Woolworths sells no Beyond Meat product, was a
    // claim the recording never supported, and the test below is what settles
    // it the other way.
    //
    // Nothing in the application reads this endpoint any more.
    const payload = fixture("search-beyond-meat") as { Products?: { Products?: unknown[] }[] };
    const names = (payload.Products ?? [])
      .flatMap((group) => group.Products ?? [])
      .map((product) => (product as { Name?: string }).Name ?? "");

    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => /beyond\s*meat/i.test(name))).toEqual([]);
  });
});

describe("the store's own catalogue, which is what search reads now", () => {
  const category = findCategoryById("1_2DDBF53");

  it("offers a department shortcut, and does not pretend it is complete", () => {
    // Woolworths' menu carries an "All <Department>" node whose id is the
    // department's own. Bakery agreed exactly with the union of its twenty
    // leaves, 491 against 491, and so did Dairy at 1,262. Two departments was
    // not enough to conclude anything: across the whole shop the 25 department
    // nodes returned 28,882 products and the 1,475 leaves returned 31,627.
    //
    // So the shortcut is a speed option and never the default, and this test
    // exists so nobody re-derives it from a two department sample the way it
    // was first derived here.
    const departments = foodDepartmentCategories();
    const level1s = departments.map((category) => category.level1);

    expect(departments).toHaveLength(12);
    expect(new Set(level1s).size).toBe(12);
    expect(level1s).toContain("Bakery");
    expect(level1s).toContain("Dairy, Eggs & Fridge");

    // The Bakery department node is the level one Bakery id, which is the whole
    // reason this works and the easiest thing to break by "tidying" the tree.
    expect(departments.find((category) => category.level1 === "Bakery")?.categoryId).toBe(
      "1_DEB537E"
    );
  });

  it("keeps Electronics and Home & Lifestyle out of a food sweep", () => {
    expect(foodDepartmentCategories().every((category) => category.isFood)).toBe(true);
    expect(allLeafCategories().length).toBeGreaterThan(foodLeafCategories().length);
  });

  it("can reach the whole shop, and every department has a node to reach it by", () => {
    // --whole-shop sweeps these. If any department lacked an "All" node the
    // sweep would silently miss it, so the count is pinned to the tree.
    const departments = departmentCategories();
    const level1s = new Set(allLeafCategories().map((category) => category.level1));

    expect(departments).toHaveLength(25);
    expect(new Set(departments.map((category) => category.level1))).toEqual(level1s);
  });

  it("knows the leaf the Beyond Meat card names", () => {
    // A ProductCard carries its three level path as names and never as ids, so
    // this lookup is the only way back from a product to the shelf it came off.
    expect(findCategoryByPath("Dairy, Eggs & Fridge", "Vegetarian & Meat Free")?.categoryId).toBe(
      "1_2DDBF53"
    );
  });

  it("finds the Beyond Meat the national search could not see", () => {
    // The recorded store ranges it, the category
    // read at that store returns it, and the search that used to run here never
    // reached it under any phrasing.
    const page = mapCategoryPage(fixture("category-vegetarian"), RECORDED_STORE, category!);
    const beyond = page.entries.find((entry) => /beyond\s*meat/i.test(entry.name));

    expect(beyond).toBeDefined();
    expect(beyond!.stockcode).toBe("751425");
    expect(beyond!.name).toBe("Beyond Meat Beyond Burger Plant Based Patties 226g 2 Pack");
    expect(beyond!.price).toBe(11);
    expect(beyond!.isAvailable).toBe(true);
    expect(beyond!.locationText).toBe("Dairy");
    expect(beyond!.categoryLevel3).toBe("Vegetarian & Meat Free");
    // The sweep used to drop this field, which is why the catalogue could not
    // tell a bunch of coriander from a bag of spinach.
    expect(beyond!.unitPriceDescription).toBe("$48.67 per 1kg");
  });

  it("strips the padding off a product id, so a product read and a sweep agree", () => {
    const page = mapCategoryPage(fixture("category-vegetarian"), RECORDED_STORE, category!);
    expect(page.entries.every((entry) => !entry.stockcode.startsWith("0"))).toBe(true);
  });

  it("keeps the page's own paging, so a sweep knows when a shelf is finished", () => {
    const page = mapCategoryPage(fixture("category-vegetarian"), RECORDED_STORE, category!);
    expect(page.total).toBe(35);
    expect(page.nextPage).toBeNull();
    expect(page.entries).toHaveLength(35);
  });

  it("drops anything in the feed that is not a product card", () => {
    const page = mapCategoryPage(
      {
        data: {
          productsByCategory: {
            totalNumberOfProducts: 2,
            nextPage: null,
            productsFeed: [
              { __typename: "ActionableCard", image: "banner.png" },
              { __typename: "ProductCard", productId: "000000000000023038", name: "Macro Firm Tofu 450g", price: 280, isAvailable: true },
              { __typename: "ProductCard", productId: "", name: "No stockcode" },
            ],
          },
        },
      },
      RECORDED_STORE,
      category!
    );

    expect(page.entries).toHaveLength(1);
    expect(page.entries[0].stockcode).toBe("23038");
    expect(page.entries[0].price).toBe(2.8);
  });

  it("carries a null price through as null, because a null is not free", () => {
    const page = mapCategoryPage(
      {
        data: {
          productsByCategory: {
            productsFeed: [
              { __typename: "ProductCard", productId: "000000000000751425", name: "Beyond Meat", price: null, isAvailable: false },
            ],
          },
        },
      },
      RECORDED_STORE,
      category!
    );

    expect(page.entries[0].price).toBeNull();
    expect(page.entries[0].isAvailable).toBe(false);
  });
});

describe("the test suite itself", () => {
  it("never calls Woolworths", () => {
    // Split so that this file does not trip its own check.
    const host = ["prod.mobile-api", "woolworths.com.au"].join(".");
    const fetchingModule = ["woolworths", "client"].join("/");

    for (const name of readdirSync(TESTS_DIR).filter((file) => file.endsWith(".test.ts"))) {
      const source = readFileSync(path.join(TESTS_DIR, name), "utf8");

      expect(source, name).not.toContain(host);
      expect(source, name).not.toContain(fetchingModule);
    }
  });
});
