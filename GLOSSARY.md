# woolworths-catalogue

The words the code, the README and the tests use that a newcomer would not know. Seeded on
7 October 2026 from the source, both READMEs and the merged changes.

## The shop

**Store number**:
The number Woolworths gives one supermarket, such as 3304. Every read is against one store, because
price, stock and shelf differ between stores.
_Avoid_: store id, branch, location

**Stockcode**:
Woolworths' number for one product, such as 23038. The same stockcode at two stores is two rows.
_Avoid_: SKU, product number, item id

**Product id**:
The stockcode padded with zeros to eighteen digits, which is what the gateway accepts. The padding
goes on at the wire and comes off in the mapper.
_Avoid_: padded stockcode, long id

**Ranged**:
A store carries the product on a shelf, whether or not it is in stock today. Its opposite is not
ranged: the store never holds it.
_Avoid_: stocked, carried, listed

**Availability**:
One of four answers about a product at one store: `in_stock`, `unavailable` (ranged, empty today),
`see_in_store` (sold, shelf not given) or `not_ranged`.
_Avoid_: stock status, in stock flag

**Location**:
Where the product sits in the store: the location text, zone, aisle, aisle side and bay. Any of
them can be null.
_Avoid_: shelf position, placement

**Panel**:
The nutrition panel, read per 100 g or per 100 mL. The per serving column is unreliable and is not
the one to read. A panel describes the product, never this store.
_Avoid_: nutrition info, label, facts

**Pack size**:
The pack read out of the product name. It holds a display string, an amount and a unit: grams,
millilitres or count. A countable pack carries no mass.
_Avoid_: package size, weight, quantity

## Prices and tags

**Unit price**:
The shelf label's price per measure, such as "$6.22 per 1kg", carried as the label writes it.
_Avoid_: price per kilo, comparison price

**Promotion**:
What the shelf tag says beyond the price: `SPECIAL`, `LOWER_SHELF_PRICE` or `LOW_PRICE`, with its
label. Only one of the three is a special.
_Avoid_: deal, discount, sale

**Special**:
A real, temporary price cut, promotion type `SPECIAL`. Its label states the saving.
_Avoid_: sale, on promo

**Lower shelf price**:
A permanent price drop, promotion type `LOWER_SHELF_PRICE`. The was-price carries the date it
dropped.
_Avoid_: markdown, special

**Everyday low price**:
A claim about the price with nothing changed, promotion type `LOW_PRICE`. It has no was-price.
_Avoid_: low price special

**Was-price**:
The old price on the tag. `wasPriceDisplay` keeps the text as written. `wasPrice` is the dollars
read out of it. "Range was" is the range's old price, not this product's.
_Avoid_: previous price, RRP

**Multibuy**:
A deal on buying more than one, such as "2 for $8.00", with its own rate. It is separate from a
promotion, and a product can carry one with every promotion field null.
_Avoid_: bundle, promotion, bulk price

## The wire

**Gateway**:
The mobile GraphQL API the Woolworths app reads. The client calls it anonymously with GET.
_Avoid_: API, backend, endpoint

**Website search**:
The search on the Woolworths website. It is national and misses stock a store carries, so the tool
does not use it.
_Avoid_: search API, product search

**Store locator**:
The website route that answers the stores near a postcode. It is the only route from a postcode to
a store number.
_Avoid_: store finder, store search

**Feed**:
The list a product or category read answers, a union of cards, banners and ad containers. The
gateway returns only the items whose fragments the query spreads.
_Avoid_: results, items

**Degraded response**:
The canned HTTP 200 payload the gateway answers when it does not like the caller. The client spots
it by keys the query never asked for and retries.
_Avoid_: soft error, bad response, blocked

**Empty feed**:
A product read that answers no feed items. It means the query asked for nothing the gateway could
match. It never means the store lacks the product, so the client raises.
_Avoid_: not found, missing product

## Categories and the sweep

**Taxonomy**:
The national category tree in `data/category-taxonomy.json`, walked three levels deep. It is the
same for every store.
_Avoid_: category list, menu

**Leaf category**:
A category at the third level of the taxonomy, the only kind the gateway's category read answers
usefully. There are 1,475.
_Avoid_: subcategory, aisle

**Department**:
A first level category, such as Bakery. Its "All" node returns most of the department in one read
and misses some products.
_Avoid_: section, top category

**Sweep**:
Reading every leaf category at one store, page by page, into a JSONL file. Searching is a read of
that file, not a call.
_Avoid_: crawl, scrape, index run

**Sweep file**:
The JSONL a sweep writes, one catalogue entry per line and about four lines per product. It is the
interface for every other language.
_Avoid_: dump, export, catalogue file

**Catalogue entry**:
One line of a sweep file: one product on one shelf at one store. It carries price, availability,
tags, category path and location text. `parseCatalogueEntry` checks it.
_Avoid_: sweep row, record

**Product row**:
What a single product read returns: price, tags, availability, pack size, full location and the
panel. It carries no category. `fetchProductWithShelf` returns the shelf beside it.
_Avoid_: product, result

## Testing

**Fixture**:
A raw gateway or website response in `data/fixtures/`, recorded by the smoke script with
`--record`. The suite reads only these and never calls Woolworths.
_Avoid_: mock, sample, stub data

**Smoke script**:
`scripts/smoke.ts`, run by hand. It is the one script that reads one product or category live and
records fixtures.
_Avoid_: live test, probe
