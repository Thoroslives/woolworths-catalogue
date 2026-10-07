---
name: verify
description: Check a woolworths-catalogue change end to end without calling Woolworths. Runs the suite, the type check and the build, drives the real client through a stub fetch that serves the recorded responses, searches the result, and imports the packed library from a scratch consumer. Use when reviewing or finishing any change to the client, the mapper, the sweep, the search or the public surface.
---

# Verify a woolworths-catalogue change

The tests say the mapper agrees with the recordings. This recipe runs the code paths a user runs:
the sweep, the product read and the search. It also installs the package the way a consumer does. It reaches
no network beyond the npm registry for `npm ci`. Run everything from the repo root.

## 1. Know what changed

Diff with three dots, which compares against the merge base:

```bash
git fetch origin main
git diff origin/main...HEAD --stat
```

## 2. Install, test, type check, build

```bash
npm ci
npm test
npm run typecheck
npm run build
```

On 7 October 2026 the suite ran 88 tests in 4 files, and the type check and the build were clean.
A change that adds behaviour adds tests, so the count goes up. Read the count, not only the colour.

## 3. Drive the client offline

`offline.ts` in this folder runs the real client with a stub `fetch`. The stub serves files from
`data/fixtures/` and throws on any URL that is not the gateway, so nothing leaves the machine. The
store number only labels the rows.

```bash
V=.claude/skills/verify
R=/tmp/ww-verify
mkdir -p $R
npx tsx $V/offline.ts sweep 3304 $R/sweep.jsonl
npx tsx $V/offline.ts product 3304 23038 details-in-stock-perimeter
npx tsx $V/offline.ts product 3304 263094 details-on-special
npx tsx $V/offline.ts degraded 3304 23038
```

What each one ran on 7 October 2026:

| Mode | What it exercises | Result |
|---|---|---|
| `sweep` | `sweepStore` over the three recorded categories, page guard included | 59 rows from 3 of 3 categories, none truncated |
| `product` with the tofu recording | `fetchProduct`, the mapper, pack size and the panel | $2.80, `in_stock`, 450 g, panel per 100 g present |
| `product` with the special recording | the promotion read | $6.30, "Was $7.00", `SPECIAL`, "SAVE $0.70" |
| `degraded` | the degraded detector and retry | refused after 3 attempts with `WoolworthsDegradedError` |

The sweep serves page 1 of each category from its recording. Two recordings say a page 2 exists and
nothing recorded it, so page 2 answers an empty last page. To exercise another recording, add it to
`CATEGORY_FIXTURES` in `offline.ts` by the category id it is a read of.

## 4. Search what the sweep wrote

```bash
npm run search -- --file $R/sweep.jsonl tofu --limit 5
npm run search -- --file $R/sweep.jsonl beyond meat --limit 3
npm run search -- --file $R/sweep.jsonl zzznothing
grep -c '"multiBuyPrice":"' $R/sweep.jsonl
grep -c '"promotionType":"' $R/sweep.jsonl
```

On 7 October 2026 `tofu` answered Macro Firm Tofu 450g first, at $2.80 and in stock. `beyond meat`
answered stockcode 751425, the Beyond Burger patties. The nonsense word printed the "proves
nothing" line. The file held 4 rows with a multibuy and 8 with a promotion.

## 5. Install the package the way a consumer does

```bash
npm pack --pack-destination $R
mkdir -p $R/consumer && cd $R/consumer
echo '{"name":"consumer","private":true,"type":"module"}' > package.json
npm install --offline --no-audit --no-fund $R/woolworths-catalogue-0.1.0.tgz
node -e 'import("woolworths-catalogue").then(m => { console.log(Object.keys(m).length, "exports"); console.log(m.allLeafCategories().length, "leaf categories"); })'
cd -
```

On 7 October 2026 this printed 19 exports and 1475 leaf categories. That proves the build, the `.js`
import suffixes and the JSON import attribute all work under plain Node. A change to
`src/index.ts` changes the export count. Check it against `tests/index.test.ts`.

## 6. What to check

1. The change's own examples, each one, through the step above that reaches them.
2. Inputs the change did not list. A mapper change gets three recordings: the field missing, the
   field null, and odd formatting. A search change gets plurals, a word that
   matches nothing and a word that matches inside another word.
3. A new field on `CatalogueEntry` must still let an older sweep file parse. Search a sweep file
   written before the change.
4. No new runtime dependency in `package.json`.

## What cannot run here

Nothing in this recipe calls Woolworths, so it cannot show that the gateway still answers the way
the recordings say. `npm run smoke` and `npm run sweep` call the live gateway and the website. Run
them by hand outside a sandbox, at store 3304, when a change depends on what Woolworths answers
today. Say in the evidence which you ran. A live sweep is about 1,500 requests, so prefer
`--limit 5`.
