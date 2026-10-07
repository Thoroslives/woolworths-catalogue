# The suite reads recorded responses only

Recorded 7 October 2026, from `data/fixtures/README.md`, `src/client.ts`, `scripts/smoke.ts` and the
tests. The decision is older than this record.

## Context

The gateway is private, unversioned and judges its caller. The same request sent by `curl` gets a
canned degraded payload every time, while the Node client gets data. A test that called Woolworths
would fail for reasons unrelated to the change under test. It would also send traffic nobody asked
for.

## Decision

No test calls Woolworths. Every test reads a raw response from `data/fixtures/`, and
`scripts/smoke.ts` is the one script that calls the gateway, run by hand.

- `npm run smoke -- --record <name>` records a fixture. Nobody writes one by hand.
- `data/fixtures/README.md` names the command behind each fixture and the fact it proves.
- A fixture that pins a wrong conclusion gets deleted. Two early recordings claimed the gateway
  serves no nutrition panel. They asked the wrong question, and the history drops them.
- A recording of a failure stays when a decision rests on it. The website search recordings are
  the example.

## Consequences

- `npm test` runs offline, in under a second, on any machine.
- The suite knows only what the recordings show. A gateway change goes unseen until someone runs
  the smoke script. Then they record the new answer and change the mapper to match.
- Fixtures keep the store number of their recording, so the tests name stores that the docs do
  not.
