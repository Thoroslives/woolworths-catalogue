# Recorded responses

Every test in this repository reads one of these files. Nothing in the suite calls Woolworths, so
these files are the whole of what the suite knows about the shop.

The smoke script recorded each one off the live gateway. Most were recorded on 2026-08-02 against
one store, with a Sydney store as the control. The store locator was recorded on 2026-09-04
against postcode 3000:

```
npm run smoke -- --store <store> --stockcode 23038 --record details-in-stock-perimeter
npm run smoke -- --store <store> --category 1_2DDBF53 --page-size 5 --record category-vegetarian-five
npm run smoke -- --postcode 3000 --record store-locator-3000
```

The two `search-*` files are the website's search, two plain GETs on www.woolworths.com.au. That
search is national and knows nothing about a store's shelf, which is why the tool does not use it.
The smoke script no longer has a `--search` flag. The files stay because they record why.

## What each one proves

| File | Product | What it proves |
| --- | --- | --- |
| `details-in-stock-perimeter.json` | Macro Firm Tofu 23038 | On the shelf, on the perimeter: zone `DAIRY`, aisle 79, no printed aisle. Also the worked nutrition panel |
| `details-centre-of-store.json` | WW Pasta Spaghetti 346830 | Centre of store: aisle 6, bay 8, right hand side |
| `details-ranged-unavailable.json` | Macro Organic Chick Peas 700638 | Ranged and off the shelf today: a bay, and no price |
| `details-see-in-store.json` | Sorbent Toilet Paper 6063933 | Ranged, stock unknown: sold today at $16 and the store will not say where. No panel |
| `details-never-carried.json` | Plantitude Christmas Roast 114218 at the control store | Never carried: no shelf, no price, not offered, and a panel all the same |
| `details-produce.json` | Banana 133211 | Produce: no shelf co-ordinates, no panel, and plainly still ranged |
| `details-not-ranged.json` | Macro Plain Tempeh 88186 at the recorded store | Not carried here: a card, no shelf, not offered. It names its shelf all the same |
| `details-not-ranged-control-1248.json` | Macro Plain Tempeh 88186 at the control store | The same stockcode on a shelf at another store |
| `details-countable-pack.json` | Free Range Eggs 582117 | "600g 12 Pack": a countable pack that must not be weighed |
| `details-bad-serving-column.json` | Macro Satay Tofu 748945 | A 200 g pack declaring a 2.0 g serving. Woolworths' own data, and wrong |
| `category-vegetarian.json` | Vegetarian & Meat Free, page 1 | A full category page at the recorded store |
| `category-vegetarian-five.json` | Vegetarian & Meat Free, page 1 | The same read at five cards, with aisle, bay and price |
| `store-locator-3000.json` | Postcode 3000 | The website's store locator: QV 3304 first, and the shops around it |
| `search-kewpie-mayonnaise.json` | "kewpie mayonnaise" | The website's search working: six Kewpies |
| `search-beyond-meat.json` | "beyond meat" | The website's search failing: two dog chews for a brand the store shelves |
| `degraded-response.json` | none | The canned payload the gateway answers when it does not like the caller |
| `products-by-product-ids-refused.json` | Macro Firm Tofu 23038 | The batched read refusing a valid input |

## What the wire does

- **Price is cents.** `price: 280` on the 450 g tofu is $2.80, and the card's own
  `unitPriceDescription` of "$6.22 per 1kg" confirms it. The mapper converts.
- **A product id is the stockcode padded to eighteen digits.** `23038` answers nothing at all and
  `000000000000023038` answers. The padding goes on at the wire and comes off in the mapper.
- **`ProductCard` has no `brand`, no `packageSize` and no `status`.** The pack size is parsed out of
  the product name, which is where Woolworths puts it.
- **A card names its own shelf, wherever it is read from.** `categories` is a field on `ProductCard`.
  So `productDetails` answers the three level path even for a stockcode the store has never carried.
  `details-not-ranged.json` names Vegetarian & Meat Free. That resolves to `1_2DDBF53`, and
  `category-vegetarian.json` is a read of it. So the shelf an alternative would sit on is one
  call away, even when the store cannot sell the product asked for.
- **`productDetails` answers a card for every stockcode**, including one the store has never
  carried. "Not ranged" never arrives as an empty answer. The availability rules in the mapper
  separate the four cases.
- **The panel is a fact about the product, not about this shop.** A product the store does not range
  still carries one, so a panel never proves the store has it.

## The trap

**The gateway returns only the feed items whose inline fragments the query spreads.**
`feed { __typename }` answers an empty list on a product that has a full page. So the usual way to
explore a union, ask what types come back and then select them, reports nothing here. It reads as
a closed door when it is a wrong question. Ask for what you want by fragment or you get nothing.

That is why `SUPPORTED_LINKS` and the fragments in `PRODUCT_DETAILS_QUERY` are the same list. It is
also why the client raises on an empty feed. Writing a row that says the shop has never heard of a
product sitting on the shelf would be worse.

Two earlier recordings claimed the gateway serves no panel at all. They were the wrong question
asked twice. They were deleted rather than kept, because a fixture that pins a wrong conclusion is
worse than no fixture.

## What the gateway will not do

**No search.** `searchProducts` is not a field on its query type. The gateway answers
`Cannot query field "searchProducts"` and suggests `recipeProducts`.

**No store search either.** That is why the store locator is a website route. `Latitude` and
`Longitude` sent empty beside a `Name` get HTTP 400 with a body that says 500. `PostCode` on its own
gets an answer.

**No batched read.** `productsByProductIds` answers `BAD_USER_INPUT` to every input tried: the
client's own selection shape, its full argument set including `requestSource`, and padded ids. So
reading many products is one call per product.

**The website search misses stock the store has.** `search-beyond-meat.json` records two dog chews
for "beyond meat", and nothing at all for "beyond meat mince" or "beyond burger". Woolworths sells
Beyond Meat Plant Based Burger Patties 226g, stockcode 751425, and searching "beyond" in the
Woolworths app returns it first. This search never answers it under any term tried, while
`v2 mince` and `impossible mince` answer their grocery rows perfectly well. The reason is not known.
The recording stays because a claim about somebody else's catalogue has to be checkable later.

## Recording another one

Record with the smoke script and never by hand. The gateway judges a caller by more than the
User-Agent. The same request sent by curl gets the canned degraded payload every time, and from the
Node client it gets data. `degraded-response.json` is that curl recording, and it is HTTP 200.
