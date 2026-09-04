/**
 * The nutrition panel, turned from what a label says into numbers that scale.
 *
 * Woolworths answers a panel as a table of strings: a header row naming the
 * columns and one row per nutrient, each cell carrying its own unit. None of it
 * is typed and some of it is qualified, so "< 1.5g" and "-" both turn up in the
 * wild and neither is a number.
 *
 * Two rules decide everything here and both are the spec's:
 *
 *   - **The per 100 column is the one that scales.** The per serving column is
 *     read and kept, and nothing computes from it, because a serving is whatever
 *     the packet decided it was and Macro Satay Tofu declares a 2.0 g serving on
 *     a 200 g pack. Reading that column puts the product last by a factor of
 *     fifty on a number that is right.
 *   - **The column is found by its heading, never by its position.** The header
 *     reads "Quantity Per 100g / 100mL", and which of the two it is depends on
 *     whether the product is a solid or a liquid.
 */

/** Macronutrients per 100 g or per serving: kilocalories, protein, carbohydrate, fat and fibre in grams. */
export interface Macros {
  cal: number;
  p: number;
  c: number;
  f: number;
  fiber: number;
}

/** The panel as it arrived, beside the two columns read out of it. */
export interface ProductNutrition {
  /** The column that scales: grams per 100 g, or per 100 mL for a liquid. */
  per100: Macros;
  /** Kept because the panel carries it. Nothing computes from it. */
  perServing: Macros | null;
  /** True when the panel is per 100 mL rather than per 100 g. */
  isPerMillilitre: boolean;
  /** What the packet claims, both display strings, neither of them trusted. */
  servingSize: string | null;
  servingsPerPack: string | null;
  /** The table exactly as it arrived, so nothing is lost to this parser. */
  tableHeaderRow: string[];
  tableRows: string[][];
}

interface RawNutritionPanel {
  title?: string | null;
  servingSize?: string | null;
  servingsPerPack?: string | null;
  tableHeaderRow?: string[] | null;
  tableRows?: string[][] | null;
}

const EMPTY: Macros = { cal: 0, p: 0, c: 0, f: 0, fiber: 0 };

/** One kilocalorie is 4.184 kilojoules, and Woolworths answers in kilojoules. */
const KJ_PER_CALORIE = 4.184;

/**
 * Which nutrient a row is, by the label the panel uses. Matching is on the
 * whole label lowercased, because the indented rows share a prefix with the
 * ones above them: "Fat, Total" and "- Saturated" are two different rows and
 * only the first is the fat this app means.
 */
const NUTRIENT_BY_LABEL: Record<string, keyof Macros> = {
  energy: "cal",
  protein: "p",
  "fat, total": "f",
  "total fat": "f",
  carbohydrate: "c",
  "carbohydrate, total": "c",
  "dietary fibre": "fiber",
  "dietary fiber": "fiber",
};

export function mapNutrition(panel: RawNutritionPanel | null | undefined): ProductNutrition | null {
  const header = panel?.tableHeaderRow ?? [];
  const rows = panel?.tableRows ?? [];
  if (rows.length === 0) return null;

  const per100Index = findColumn(header, /per\s*100/i);
  if (per100Index < 0) return null;
  const perServingIndex = findColumn(header, /per\s*serv/i);

  return {
    per100: readColumn(rows, per100Index),
    perServing: perServingIndex < 0 ? null : readColumn(rows, perServingIndex),
    isPerMillilitre: /100\s*ml/i.test(header[per100Index] ?? "") && !/100\s*g/i.test(header[per100Index] ?? ""),
    servingSize: panel?.servingSize?.trim() || null,
    servingsPerPack: panel?.servingsPerPack?.trim() || null,
    tableHeaderRow: header,
    tableRows: rows,
  };
}

function findColumn(header: string[], pattern: RegExp): number {
  return header.findIndex((cell) => pattern.test(cell ?? ""));
}

function readColumn(rows: string[][], index: number): Macros {
  const macros: Macros = { ...EMPTY };

  for (const row of rows) {
    const nutrient = NUTRIENT_BY_LABEL[normaliseLabel(row?.[0])];
    if (!nutrient) continue;

    const amount = readAmount(row?.[index]);
    if (amount === null) continue;

    macros[nutrient] = nutrient === "cal" ? toCalories(amount) : amount.value;
  }

  return macros;
}

/**
 * The indented rows arrive with a leading dash, and it is an en dash on the
 * wire rather than a hyphen. Stripping it would merge "- Saturated" into the
 * fat above it, so it is kept and the label is matched whole.
 */
function normaliseLabel(label: string | undefined): string {
  return (label ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

interface Amount {
  value: number;
  unit: string;
}

/**
 * A cell is a number with its unit stuck to it, sometimes qualified.
 *
 *   "22.2g"               -> 22.2 g    a plain figure
 *   "< 1.5g"              -> 1.5 g     a limit of detection, read as the limit
 *   "812.0kJ"             -> 812 kj    energy, converted by the caller
 *   "547.4kJ(130.8Cal)"   -> 547.4 kj  the same, with the calories spelled out
 *   "Approx. 3446kJ"      -> 3446 kj   a panel that hedges its own figures
 *   "< 8.0mg"             -> 8 mg      sodium, milligrams
 *   "-"                   -> null      the panel says it does not have this
 *
 * A "less than" is read as the stated figure rather than as zero, because it is
 * the honest ceiling and reading it as zero flatters the product.
 *
 * **Some panels write energy twice in one cell**, kilojoules with the calories
 * after them in brackets. Annalisa Butter Beans 400g does; Macro Firm Tofu 450g
 * does not. A cell that carried both used to match nothing and read as absent,
 * so a product with such a cell came out with protein, carbohydrate and fibre
 * and no calories at all, which looks like a complete panel rather than a
 * broken one. The bracket is dropped and the leading figure is the answer, so both
 * spellings resolve to the same kilojoules.
 */
export function readAmount(cell: string | undefined | null): Amount | null {
  // A cell can be qualified twice over, so the prefixes come off in a loop
  // rather than one at a time: "Approx. 3446kJ" and "< 0.0kJ" both occur, and
  // nothing says the two cannot meet.
  let text = (cell ?? "").trim();
  let previous = "";
  while (text !== previous) {
    previous = text;
    text = text.replace(/^(?:approx\.?|about|<|>)\s*/i, "").trim();
  }
  if (text === "" || text === "-" || text === "–") return null;

  const match = /^([\d.]+)\s*([a-z]*)\s*(?:\([^)]*\))?$/i.exec(text);
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;

  return { value, unit: match[2].toLowerCase() };
}

/**
 * Energy comes as kilojoules, and `Macros.cal` is calories. A panel that ever
 * answers in calories is taken at its word.
 */
function toCalories(amount: Amount): number {
  const calories = amount.unit === "kj" ? amount.value / KJ_PER_CALORIE : amount.value;
  return Math.round(calories * 10) / 10;
}
