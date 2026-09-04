import { PackSize, PackUnit } from "./types.js";

/**
 * A pack size is parsed once, when the product is read, so nothing downstream
 * ever parses a string again. `packDisplay` keeps what a person reads
 * and the parsed pair is what the packet arithmetic runs on.
 *
 * The card carries no pack size field of its own, measured against the live
 * schema, so the pack is read out of the product name, which is where
 * Woolworths puts it: "Macro Firm Tofu 450g", "Banana Kids 5pk".
 *
 * Grams and millilitres, because that is what a kitchen measures in. A pack
 * sold by the item is `count` and carries no mass: reading "12 Pack" as twelve
 * grams would order two dozen eggs where a hundred grams was wanted.
 *
 * A name that yields no number is three nulls. That is a recorded fact about a
 * product rather than a crash halfway round the shop.
 */

const MASS_MULTIPLIERS: Record<string, number> = { g: 1, kg: 1000 };
const VOLUME_MULTIPLIERS: Record<string, number> = { ml: 1, l: 1000 };

const NUMBER = "(\\d+(?:\\.\\d+)?)";
const MEASURED_UNIT = "(kg|g|ml|l)";
// `ea` comes after `each` on purpose. Alternation takes the first branch that
// matches, so "1each" has to reach `each` before the shorter word eats its
// first two letters. It is also the reason `ea` never matches inside a word:
// the patterns below all anchor it on a word boundary or a space, so "Sea
// Salt" and "Green Tea 250g" are left alone.
const COUNTABLE_WORD = "(packs?|pk|each|ea|bunch|punnet|pieces?|count)";

// "12 Pack", "5pk", "40 pk": the pack the shopper picks up is a number of things.
const COUNTED = new RegExp(`${NUMBER}\\s*${COUNTABLE_WORD}\\b`, "i");
const COUNTED_REVERSED = new RegExp(`${COUNTABLE_WORD}\\s+of\\s+${NUMBER}\\b`, "i");
const BARE_COUNTABLE = new RegExp(`(?:^|\\s)${COUNTABLE_WORD}(?:$|\\s)`, "i");
// "12 x 375mL" and "375mL x 12", the multipack written either way round.
const MULTIPACK = new RegExp(`${NUMBER}\\s*x\\s*${NUMBER}\\s*${MEASURED_UNIT}\\b`, "i");
const MULTIPACK_REVERSED = new RegExp(`${NUMBER}\\s*${MEASURED_UNIT}\\s*x\\s*${NUMBER}\\b`, "i");
const MEASURED = new RegExp(`${NUMBER}\\s*${MEASURED_UNIT}\\b`, "i");

const EMPTY: PackSize = { packDisplay: null, packAmount: null, packUnit: null };

interface Parsed {
  display: string;
  amount: number;
  unit: PackUnit;
}

export function parsePackSize(text: string | null | undefined): PackSize {
  const cleaned = text?.trim().replace(/\s+/g, " ");
  if (!cleaned) return EMPTY;

  const parsed = parseAmount(cleaned.replace(/×/g, "x"));
  if (!parsed) return EMPTY;

  return { packDisplay: parsed.display, packAmount: parsed.amount, packUnit: parsed.unit };
}

function parseAmount(text: string): Parsed | null {
  // Counting first, and deliberately. "Free Range Eggs 600g 12 Pack" is both a
  // mass and a count, and the twelve is what is on the shelf and in the hand.
  //
  // **A count of one is not counting.** "Chilli Habanero P/P 35g 1ea" is one
  // packet holding 35 g, and reading the 1 as the pack size throws the only
  // measure on the label away. So a lone one waits below, where it is the
  // answer only if nothing measured the pack.
  const counted = countOf(COUNTED.exec(text), 1);
  if (counted && counted.amount > 1) return counted;

  const countedReversed = countOf(COUNTED_REVERSED.exec(text), 2);
  if (countedReversed && countedReversed.amount > 1) return countedReversed;

  const multipack = MULTIPACK.exec(text);
  if (multipack) {
    const each = measured(Number(multipack[2]), multipack[3]);
    return { display: multipack[0], amount: round(each.amount * Number(multipack[1])), unit: each.unit };
  }

  const multipackReversed = MULTIPACK_REVERSED.exec(text);
  if (multipackReversed) {
    const each = measured(Number(multipackReversed[1]), multipackReversed[2]);
    return {
      display: multipackReversed[0],
      amount: round(each.amount * Number(multipackReversed[3])),
      unit: each.unit,
    };
  }

  const single = MEASURED.exec(text);
  if (single) return { display: single[0], ...measured(Number(single[1]), single[2]) };

  // "Each", "Bunch", "Punnet", "1ea": one of the thing, and the thing has no
  // mass on the packet because it is weighed at the register or not weighed at
  // all. This is where a lone one from above lands, having lost to any measure
  // the label carried.
  const bare = BARE_COUNTABLE.exec(text);
  if (bare) return { display: bare[0].trim(), amount: 1, unit: "count" };

  return counted ?? countedReversed;
}

/** A counted match, read off the group the pattern puts the number in. */
function countOf(match: RegExpExecArray | null, group: number): Parsed | null {
  if (!match) return null;

  const amount = Number(match[group]);
  return Number.isFinite(amount) && amount > 0
    ? { display: match[0], amount, unit: "count" }
    : null;
}

function measured(amount: number, unit: string): { amount: number; unit: PackUnit } {
  const mass = MASS_MULTIPLIERS[unit.toLowerCase()];
  if (mass !== undefined) return { amount: round(amount * mass), unit: "g" };
  return { amount: round(amount * VOLUME_MULTIPLIERS[unit.toLowerCase()]), unit: "ml" };
}

// 1.25 L is 1250 mL and not 1250.0000000000002 mL.
function round(amount: number): number {
  return Math.round(amount * 1000) / 1000;
}
