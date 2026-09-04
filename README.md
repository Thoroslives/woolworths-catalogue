# woolworths-catalogue

Read one Woolworths supermarket's shelf from the command line. A product by stockcode, a category
page, the stores near a postcode, or every product in the store written to a JSONL file.

Unofficial. Woolworths publishes no API. This reads the same GraphQL gateway the Woolworths app
reads, anonymously, and it will stop working the day Woolworths changes it. Nothing here logs in
and nothing here needs a key.

## Install

Node 20.10 or later, for native `fetch` and JSON import attributes. Nothing else.

```
npm install
npm test
```

The suite runs 70 tests against recorded responses in `data/fixtures/` and never calls Woolworths.

## Use it from your own code

Install it straight from GitHub and import what you need. The package builds itself on install and
ships type declarations.

```
npm install github:Thoroslives/woolworths-catalogue
```

```ts
import {
  findStoresByPostcode, fetchProduct, fetchCategoryProducts, sweepStore, searchEntries,
  type CatalogueEntry,
} from "woolworths-catalogue";

const stores = await findStoresByPostcode("3000");          // [{ storeNumber: "3304", name: "Qv", ... }]
const tofu = await fetchProduct("23038", "3304");            // price, availability, aisle, bay, nutrition
const page = await fetchCategoryProducts("1_2DDBF53", "3304");

const rows: CatalogueEntry[] = [];
await sweepStore("3304", { onCategory: async (_category, entries) => { rows.push(...entries); } });
const patties = searchEntries(rows, "beyond meat", 5);
```

The package is ESM only, with type declarations. Every function that reaches the network takes an
optional `fetchImpl`, so a test can hand it a stub. `src/index.ts` is the whole public surface and
nothing outside it is promised.

## Use it from anything else

The sweep file is the interface for every other language. Run the sweep, read the JSONL, one
object per line with the fields listed under "Sweep a whole store". Nothing in it needs this
repository to read. The database section below loads it into Postgres with `jq` and `psql` alone.

## Find a store number

Every read is against one store, because price, aisle and stock all differ between stores on the
same product. The website's store locator answers a postcode:

```
npm run smoke -- --postcode 3000
```

That prints the stores near the postcode with their numbers. Store 3304 is the QV store in central
Melbourne, and every example below uses it.

## Read one product or one category

```
npm run smoke -- --store 3304 --stockcode 23038
npm run smoke -- --store 3304 --category 1_2DDBF53
```

The first prints one product as the mapper sees it. Price, unit price, availability, aisle and bay,
the three level category path, and the nutrition panel per 100 g and per serving. The second prints
the first page of a category. Category ids come from `data/category-taxonomy.json`, which is the
national tree walked three levels deep, and it barely moves.

Add `--record <name>` to either call and the raw response lands in `data/fixtures/<name>.json`,
which is how every fixture in this repository was made.

## Sweep a whole store

```
npm run sweep -- --store 3304 --out sweep.jsonl
```

One JSON object per line, with `storeNumber`, `stockcode`, `name`, `price` in dollars,
`isAvailable`, `unitPriceDescription`, `categoryId`, `categoryLevel1`, `categoryLevel2`,
`categoryLevel3` and `locationText`. A product sits on
several shelves, so expect about four rows per product and dedupe on `stockcode` if you want one.

The default reads all 1,475 leaf categories, because it is the only sweep proved complete. Measured
at one store on 2026-08-03 it wrote 130,534 rows carrying 31,647 distinct products in thirty one
minutes. Two faster sweeps exist and each has a measured gap.

| Flag | Categories read | Distinct products | Time | What it misses |
|---|---|---|---|---|
| none | 1,475 leaves | 31,647 | 31 min | nothing measured |
| `--departments` | 25 | 28,882 | 7 min | 2,745, all greeting cards, magazines and SIM packs |
| `--food-departments` | 12 | 11,427 | 3 min | the above, plus 24 food products including chia, flaxseed and LSA |

`--limit N` reads the first N categories and is how to check a store before committing half an
hour to it.

A full sweep is about 1,500 requests against a gateway that never asked for them. Run it once a day
at most, and never in parallel.

## Search the sweep

```
npm run search -- --file sweep.jsonl tofu
npm run search -- --file sweep.jsonl beyond meat --limit 5
```

This reads the file and never calls Woolworths. Every word typed has to appear in the product
name, in any order. What matches is then ordered, so the row somebody meant comes first.

1. A product on the shelf today comes before one that is not.
2. A name that carries more of the words as whole words comes next, plural allowed, so `tomato`
   counts in "Tomatoes" but not in "Tomatoey".
3. A name that carries more of them exactly comes next, so "Tomato Sauce" beats "Tomatoes 500g".
4. Then the words nearer the front of the name.
5. Then the shorter name, which is usually the plain product rather than a variant of it.
6. Then the name itself, so ties are stable.

A sweep holds one row per shelf a product sits on, so rows collapse to one per store and
stockcode first. The rules live in `src/search.ts`, and the database section below restates them
in SQL.

**An empty search proves a fact about the file, never one about the shop, unless the sweep behind
it finished.** A sweep cut short by a network fault holds every product it reached. It holds none it
did not. "Nothing found" and "could not look" are the same screen and opposite facts. Check the
sweep's closing line said how many products it wrote before reading absence as absence.

## Why it sweeps instead of searching

Three routes were measured on 2026-08-03 and two do not work.

| Route | Result |
|---|---|
| `productList` on the mobile gateway | The app's own search. Store aware. Answers `400 BAD_USER_INPUT` to an anonymous caller, tried nineteen ways |
| `GET /apis/ui/Search/products` on the website | Answers, but it is national and it misses stock. Searching `beyond meat` returns two dog chews while the store shelves Beyond Burger patties at $11 |
| `productsByCategory` on the mobile gateway | Answers anonymously, takes a store number, and is what the sweep reads |

So the shop is read once, category by category, and every search after that is a read of what
the sweep wrote.

## Load the sweep into a database

The file is enough for a person at a keyboard. Anything that searches often, or wants to know what
changed between two sweeps, wants a table. This is the shape below.

```sql
CREATE TABLE catalogue_products (
  store_number    TEXT NOT NULL,
  stockcode       TEXT NOT NULL,
  name            TEXT NOT NULL,
  price           NUMERIC(10, 2),          -- dollars; null when the store cannot sell it today
  is_available    BOOLEAN NOT NULL,
  unit_price_description TEXT,
  category_id     TEXT NOT NULL,
  category_level1 TEXT,
  category_level2 TEXT,
  category_level3 TEXT,
  location_text   TEXT,
  search_name     TEXT NOT NULL,           -- lower(name), held so the index below is used
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_number, stockcode)
);

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX ON catalogue_products USING GIN (search_name gin_trgm_ops);
```

**The key is the store and the stockcode together.** Price, stock and shelf differ between shops,
so a row from one store says nothing about another. The same stockcode from two stores is two
rows.

Load a sweep with `jq` and `\copy`, then fold the shelf duplicates into one row per product:

```
jq -r '[.storeNumber, .stockcode, .name, .price, .isAvailable, .unitPriceDescription,
        .categoryId, .categoryLevel1, .categoryLevel2, .categoryLevel3, .locationText,
        (.name | ascii_downcase)] | @csv' sweep.jsonl > sweep.csv
```

```sql
CREATE TEMP TABLE incoming (LIKE catalogue_products INCLUDING DEFAULTS);
\copy incoming (store_number, stockcode, name, price, is_available, unit_price_description,
       category_id, category_level1, category_level2, category_level3, location_text, search_name)
       FROM 'sweep.csv' CSV;

INSERT INTO catalogue_products
SELECT DISTINCT ON (store_number, stockcode) *
FROM incoming
ORDER BY store_number, stockcode, is_available DESC
ON CONFLICT (store_number, stockcode) DO UPDATE SET
  name = EXCLUDED.name, price = EXCLUDED.price, is_available = EXCLUDED.is_available,
  unit_price_description = EXCLUDED.unit_price_description, category_id = EXCLUDED.category_id,
  category_level1 = EXCLUDED.category_level1, category_level2 = EXCLUDED.category_level2,
  category_level3 = EXCLUDED.category_level3, location_text = EXCLUDED.location_text,
  search_name = EXCLUDED.search_name, fetched_at = now();
```

Three things learned the hard way, in the order they bite:

- **`DISTINCT ON` is not optional.** A category can list the same product twice and a product sits
  on several shelves. `ON CONFLICT DO UPDATE` refuses to touch one row twice in a single
  statement. Collapse before you insert.
- **An upsert never deletes.** A product the shop stopped stocking stays in the table claiming to
  be there. Once a week, `DELETE FROM catalogue_products WHERE store_number = '3304'` before the
  load, or compare `fetched_at` against the sweep's start and drop what it did not touch.
- **If you write rows from code rather than `\copy`, keep a statement under 65,535 parameters.**
  That is the wire protocol's 16 bit count, and it wraps rather than erroring. One category answers
  10,000 products. At the twelve columns above that is 120,000 parameters. Postgres reads the count
  as 54,464 and rejects the statement with a number that looks nothing like what you sent. Nothing
  in the SQL is wrong. Twelve columns gives a ceiling of 5,461 rows a statement, and 5,000 is a safe batch.

Then the search is the file's six rules in SQL, one `AND` per word and one regex per word per
tier:

```sql
SELECT stockcode, name, price, is_available, location_text
FROM catalogue_products
WHERE store_number = '3304'
  AND search_name LIKE '%beyond%' AND search_name LIKE '%meat%'
ORDER BY is_available DESC,
         (search_name ~ '\ybeyond(e?s)?\y')::int + (search_name ~ '\ymeat(e?s)?\y')::int DESC,
         (search_name ~ '\ybeyond\y')::int + (search_name ~ '\ymeat\y')::int DESC,
         position('beyond' in search_name) + position('meat' in search_name),
         length(name), name
LIMIT 12;
```

Keep a `sweeps` table beside it, one row per run with the store, when it started, when it
finished and how many products it wrote. That is what lets a search say whether the index behind
it finished. Without it an empty answer means nothing.

## What the wire does that you would not guess

- **Price arrives in cents** on a product card. `280` is $2.80. The mapper converts.
- **A product id is the stockcode padded to eighteen digits.** `23038` answers nothing and
  `000000000000023038` answers. The padding goes on at the wire and comes off in the mapper.
- **The gateway answers a card for every stockcode**, including one the store has never carried.
  "Not ranged" is a real answer with no shelf and no offer. It is never an empty one.
- **The gateway returns only the feed items whose inline fragments the query spreads.** Ask for a
  union by `__typename` alone and you get an empty list on a product with a full page.
- **When the gateway dislikes the caller it answers HTTP 200 with a canned payload** for a
  question nobody asked. `src/degraded.ts` detects it by the keys that come back and the client
  retries. The same request from `curl` gets that payload every time. From Node it gets data.
- **Read the per 100 g nutrition column, never the per serving one.** Woolworths' own data
  declares a 2.0 g serving on a 200 g pack of tofu, and it has stayed wrong.

## What it does not do

No search on the mobile gateway, because `searchProducts` is not a field there. No batched read,
because `productsByProductIds` refuses every input tried. No member login, so no online prices and
no basket. Two departments answer zero at every supermarket, Everyday Market and Healthylife,
because neither is on a shelf. Beer, Wine & Spirits answers five zero alcohol lines, because BWS
sells the rest.

## Maintenance

This is a snapshot rather than a maintained package. Woolworths changes the gateway without
notice, so when a call stops working expect to fix it here yourself. `scripts/smoke.ts` is where to
find out what changed: run it against the product or category that broke and read the raw response.

## Licence

MIT. See `LICENSE`.
