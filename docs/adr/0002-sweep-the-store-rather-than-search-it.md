# Sweep the store rather than search it

Recorded 7 October 2026, from `README.md` ("Why it sweeps instead of searching"), `src/catalogue.ts`,
`scripts/sweep.ts` and `data/fixtures/README.md`. The measurements date from 3 August 2026.

## Context

A person wants to find a product at one store by name. The measurements covered three routes.

- `productList` on the gateway is the app's own search and is store aware. It answers
  `400 BAD_USER_INPUT` to an anonymous caller, tried nineteen ways.
- The website search answers, but it is national and misses stock. It answers two dog chews for
  "beyond meat" while the store shelves Beyond Burger patties.
- `productsByCategory` on the gateway answers anonymously and takes a store number.

## Decision

Read the whole store once, category by category, through `productsByCategory`, and write it to a
JSONL sweep file. Every search after that reads the file and calls nothing.

The default sweep reads all 1,475 leaf categories, because it is the only sweep proved complete.
At one store on 3 August 2026 it wrote 31,647 distinct products in about thirty minutes. The faster
`--departments` and `--food-departments` sweeps stay as options, each with its measured gap in the
README.

## Consequences

- A search is instant and offline, and it ranks rows the same way in TypeScript and in the README's
  SQL.
- An empty search proves a fact about the file, not the shop, unless the sweep behind it finished.
  The search script says so when it finds nothing.
- A full sweep is about 1,500 requests, so it runs once a day at most and never in parallel.
- The two website search recordings stay in `data/fixtures/` as the evidence for this record.
