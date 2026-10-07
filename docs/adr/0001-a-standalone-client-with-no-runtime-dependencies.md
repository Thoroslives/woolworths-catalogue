# A standalone client with no runtime dependencies

Recorded 7 October 2026, from `README.md`, `package.json`, `src/index.ts` and the commit history
from 4e6af72 (4 September 2026) onwards. The decision is older than this record.

## Context

The code began as the Woolworths client inside another application. Woolworths publishes no API.
The only route to a store's shelf is the GraphQL gateway the Woolworths app reads. It answers an
anonymous GET with no key.

The client was cut out on 4 September 2026 as a standalone package. Comments that described the
original application were rewritten in terms of products and stores.

## Decision

Ship the client as its own MIT licensed repository, in TypeScript, with zero runtime dependencies.

- Node 20.10 or later, for native `fetch` and the JSON import attribute that loads the category
  tree.
- ESM only, with type declarations. `src/index.ts` is the whole public surface, and a test pins it.
- Installable straight from GitHub. `prepare` runs the TypeScript build on install.
- The command line is three `tsx` scripts: `smoke`, `sweep` and `search`.
- No database. A sweep writes JSONL, and the README shows how to load it into Postgres with `jq` and
  `psql` alone.

## Consequences

- A consumer installs one package and nothing else. A test hands the client a stub through the
  optional `fetchImpl` every network function takes.
- Every other language reads the sweep file, so nothing outside TypeScript needs this repository.
- The gateway is private and changes without notice. The repository is a snapshot rather than a
  maintained package, and `scripts/smoke.ts` is where a reader finds out what changed.
