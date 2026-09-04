import { describe, expect, it } from "vitest";
import { parseCatalogueEntry, type CatalogueEntry } from "../src/catalogueTypes.js";
import { dedupeByStoreAndStockcode, searchEntries } from "../src/search.js";
import { readArgs } from "../scripts/argv.js";

function entry(stockcode: string, name: string, extra: Partial<CatalogueEntry> = {}): CatalogueEntry {
  return {
    storeNumber: "3304",
    stockcode,
    name,
    price: 2.5,
    isAvailable: true,
    unitPriceDescription: null,
    categoryId: "1_X",
    categoryLevel1: "Fruit & Veg",
    categoryLevel2: null,
    categoryLevel3: null,
    locationText: null,
    ...extra,
  };
}

const codes = (rows: CatalogueEntry[]) => rows.map((row) => row.stockcode);

describe("searchEntries", () => {
  it("answers nothing for an empty term", () => {
    expect(searchEntries([entry("1", "Tofu")], "   ", 12)).toEqual([]);
  });

  it("needs every word in the name, in any order", () => {
    const rows = [entry("1", "Beyond Meat Beyond Burger 226g"), entry("2", "Beyond Burger Sauce"), entry("3", "Meat Pie")];
    // Both carry both words. The shorter name with the words nearer the front wins.
    expect(codes(searchEntries(rows, "burger beyond", 12))).toEqual(["2", "1"]);
    expect(codes(searchEntries(rows, "beyond meat", 12))).toEqual(["1"]);
  });

  it("puts what is on the shelf today first", () => {
    const rows = [entry("1", "Firm Tofu 450g", { isAvailable: false }), entry("2", "Firm Tofu 300g")];
    expect(codes(searchEntries(rows, "tofu", 12))).toEqual(["2", "1"]);
  });

  it("counts a plural as a whole word and a longer word as a fragment", () => {
    const rows = [entry("1", "Tomatoey Pasta Sauce 500g"), entry("2", "Truss Tomatoes 500g"), entry("3", "Roma Tomato")];
    expect(codes(searchEntries(rows, "tomato", 12))).toEqual(["3", "2", "1"]);
  });

  it("puts an exact word above a plural, even on a longer name later in the alphabet", () => {
    // Same position, both whole words. Only the exact tier separates them, and
    // it has to beat both the length and the name tiers below it.
    const rows = [entry("1", "Tomatoes 500g"), entry("2", "Tomato Sauce 2L")];
    expect(codes(searchEntries(rows, "tomato", 12))).toEqual(["2", "1"]);
  });

  it("prefers the word nearer the front, then the shorter name", () => {
    const rows = [entry("1", "Organic Honey 500g"), entry("2", "Honey 500g"), entry("3", "Honey 1kg Squeeze Bottle")];
    expect(codes(searchEntries(rows, "honey", 12))).toEqual(["2", "3", "1"]);
  });

  it("honours the limit", () => {
    const rows = [entry("1", "Milk 1L"), entry("2", "Milk 2L"), entry("3", "Milk 3L")];
    expect(searchEntries(rows, "milk", 2)).toHaveLength(2);
  });

  it("treats regex characters in the term as text", () => {
    expect(searchEntries([entry("1", "Coke (No Sugar) 1.25L")], "(no sugar)", 12)).toHaveLength(1);
  });

  it("knows an accented letter is a letter, so café is a whole word", () => {
    const rows = [entry("1", "Cafétiere 8 Cup"), entry("2", "Nescafé Café Menu Latte 10pk")];
    expect(codes(searchEntries(rows, "café", 12))).toEqual(["2", "1"]);
  });
});

describe("dedupeByStoreAndStockcode", () => {
  it("keeps one row per store and stockcode, and lets an available row win", () => {
    const rows = [
      entry("1", "Tofu", { isAvailable: false, locationText: "Aisle 3" }),
      entry("1", "Tofu", { isAvailable: true, locationText: "Dairy" }),
      entry("1", "Tofu", { storeNumber: "1248" }),
      entry("2", "Tempeh"),
    ];
    const kept = dedupeByStoreAndStockcode(rows);
    expect(kept).toHaveLength(3);
    expect(kept.find((r) => r.stockcode === "1" && r.storeNumber === "3304")?.locationText).toBe("Dairy");
  });
});

describe("parseCatalogueEntry", () => {
  it("accepts a line the sweep wrote", () => {
    const line = {
      storeNumber: "3304", stockcode: "961095", name: "Little Ones Baby Wipes 80pk", price: 2,
      isAvailable: true, unitPriceDescription: "$2.50 per 100EA", categoryId: "1_717A94B",
      categoryLevel1: "Baby", categoryLevel2: "Wipes & Changing", categoryLevel3: "Wipes", locationText: "Aisle 8",
    };
    expect(parseCatalogueEntry(line)).toEqual(line);
  });

  it("names the missing field on a line from an older shape", () => {
    expect(() => parseCatalogueEntry({ storeNumber: "3304", name: "Tofu" })).toThrow("stockcode");
    expect(() => parseCatalogueEntry("not an object")).toThrow("not an object");
    expect(() => parseCatalogueEntry({ storeNumber: "3304", stockcode: "1", name: "Tofu", price: "2", categoryId: "x" })).toThrow("price");
  });
});

describe("readArgs", () => {
  it("separates value flags, switches and positionals", () => {
    const args = readArgs(["--file", "s.jsonl", "coke", "5", "--limit", "5", "--fresh"], ["--file", "--limit"]);
    expect(args.values["--file"]).toBe("s.jsonl");
    expect(args.values["--limit"]).toBe("5");
    expect(args.switches.has("--fresh")).toBe(true);
    // A positional that happens to equal a flag's value is still a positional.
    expect(args.positional).toEqual(["coke", "5"]);
  });
});
