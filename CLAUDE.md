# woolworths-catalogue

A TypeScript command line client and library that reads one Woolworths supermarket's shelf. It reads
the same GraphQL gateway the Woolworths app reads, anonymously, with no key and no login. It reads a
product, a category page or the stores near a postcode. It sweeps a whole store to JSONL and
searches the sweep. Woolworths publishes no API, so this breaks whenever Woolworths changes the gateway.

Read these before you change anything:

- `GLOSSARY.md` for the words this repo uses. Use its terms in code, test names and commit messages.
- `docs/adr/` for the decisions behind the code.
- `README.md` for every command, the sweep columns, the Postgres recipe and "What the wire does that
  you would not guess".
- `data/fixtures/README.md` for what each recorded response proves and the command that recorded it.

## Build, test and run

| Step | Command |
|---|---|
| Install | `npm ci` |
| Test | `npm test` |
| Type check | `npm run typecheck` |
| Build | `npm run build` |
| Lint | none. The repo has no linter configured |
| Search a sweep file | `npm run search -- --file sweep.jsonl tofu` |
| Read one product, live | `npm run smoke -- --store 3304 --stockcode 23038` |
| Sweep a store, live | `npm run sweep -- --store 3304 --out sweep.jsonl` |

- Run `npm test` and `npm run typecheck` on every change. On 7 October 2026 `npm test` ran 88 tests
  in 4 files, and the type check and the build were clean on Node 20.20.
- `npm run build` writes `dist/`, and `.gitignore` keeps it out of git. `prepare` runs the same build when someone
  installs the package from GitHub.
- `smoke` and `sweep` call Woolworths. `search` reads a file and calls nothing.

## Check a change end to end

Run the verify recipe at `.claude/skills/verify/SKILL.md`. It drives the real client through a stub
`fetch` that serves the recorded responses, so it reaches no network. It also packs the library and
imports it from a scratch consumer.

## Rules for this repo

**Zero runtime dependencies.** The client uses native `fetch` and needs Node 20.10 or later, for the
JSON import attribute. Do not add a package to do what the platform does.

**Nothing in the test suite calls Woolworths.** Every test reads a recorded response from
`data/fixtures/`. Record a new fixture with `npm run smoke -- --record <name>` and commit it. Never
write one by hand, because the gateway judges the caller and a hand-written shape proves nothing.

**When a call stops working, record before you fix.** Run `scripts/smoke.ts` against the product or
category that broke and read the raw response. Record the new response, then change the mapper. A
fixture that pins a wrong conclusion gets deleted, not kept.

**Store 3304 is the example store in every doc and usage string.** It is the QV store in central
Melbourne. Do not put another store number in prose. A fixture keeps the store number the smoke
script recorded it at.

**`src/index.ts` is the whole public surface.** Anything not exported there may change.
`tests/index.test.ts` pins the list. A new export goes in both, and in the README if a consumer
needs it.

**Relative imports carry the `.js` suffix.** The package ships ESM, and Node's ESM resolver needs
the suffix in the emitted code even though TypeScript does not.

**Older sweep files must still parse.** A new field on `CatalogueEntry` arrives nullable, and
`parseCatalogueEntry` reads its absence as null. A sweep written before the change keeps working.

**Mind the units on the wire.** `price` arrives in cents and the mapper converts it. `wasPrice`
arrives in dollars inside a sentence, and the multibuy fields arrive as dollar strings. Never divide
those two by a hundred.

**Keep `SUPPORTED_LINKS` and the fragments in `PRODUCT_DETAILS_QUERY` the same list.** The gateway
returns only the feed items whose fragments the query spreads. A missing fragment reads as an empty
product, and the client raises on an empty feed for that reason.

**Be gentle with the gateway.** A full sweep is about 1,500 requests. Run it once a day at most and
never in parallel.

**Australian English and Australian units.** Grams and millilitres.

**This repository is public.** Nothing in it names a private server, an address or a person.

## Coding standards

`CODING_STANDARDS.md` arrives in the working tree untracked, written by a coding standards sync.
`.gitignore` lists it. Do not commit it.
