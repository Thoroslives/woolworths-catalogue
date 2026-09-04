/**
 * The gateway fails silently. Given a User-Agent it does not like it answers
 * HTTP 200 with a canned payload rather than an error, and that payload is a
 * `productsByCategory` list of nothing.
 *
 * Detecting it by operation name does not work, because a call may legitimately
 * ask for `productsByCategory`, and a real category read of a store that ranges
 * nothing is also empty. What separates the two is that the canned payload
 * carries keys nobody asked for: `sortOptions`, `filters`, `analytics`,
 * `marketplaceFilterSwitch`. A real answer carries the selection set and
 * nothing else.
 *
 * So the rule is general: any key in the response the query did not name is a
 * degraded answer, and a degraded answer is a retry rather than a result.
 */

/** GraphQL names the document mentions: fields, aliases, arguments, types, variables. */
function namesInQuery(query: string): Set<string> {
  return new Set(query.match(/[_A-Za-z][_0-9A-Za-z]*/g) ?? []);
}

/**
 * Over-collecting from the document is deliberate. Argument names and type
 * names widen the allowed set a little, which can only ever let a real response
 * through, and letting a real response through is the cheap mistake. Calling a
 * real answer degraded would retry until the client gave up on data it already
 * had.
 */
export function unrequestedKeys(query: string, data: unknown): string[] {
  const allowed = namesInQuery(query);
  const found = new Set<string>();

  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value === null || typeof value !== "object") return;

    for (const [key, child] of Object.entries(value)) {
      // __typename comes back on request and is never a tell.
      if (key !== "__typename" && !allowed.has(key)) found.add(key);
      walk(child);
    }
  };

  walk(data);
  return [...found].sort();
}

export function isDegradedResponse(query: string, data: unknown): boolean {
  return unrequestedKeys(query, data).length > 0;
}
