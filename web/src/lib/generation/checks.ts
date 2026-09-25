/**
 * What a written section can be checked for without a model — the ground
 * the scorers (`@/mastra/scorers`) stand on. Pure, so the self-check runs
 * them directly:
 *
 *   figures     every number in the prose (digits or words: "18", "eighteen",
 *               "21st", "65%") appears somewhere in the material it read
 *   names       every `owner/name` it mentions is one the material names
 *   length      the word count against its length tier's band
 *   house style no "the user", no naming the material or the section kind,
 *               no echoed heading, no table or chart markup
 */

import type { LengthTier } from "@/lib/generation/outline";

const UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const TENTHS = TENS.filter(Boolean).map((ten) => ten.replace(/y$/, "ieth"));
const ORDINALS: Record<string, string> = { first: "one", second: "two", third: "three", fifth: "five", eighth: "eight", ninth: "nine", twelfth: "twelve" };

/** `"twenty-two"` → 22, `"eighteenth"` → 18, `"sixty seven"` → 67; `null` for anything else. */
function wordNumber(phrase: string): number | null {
  const words = phrase.toLowerCase().split(/[\s-]+/).map((word) => ORDINALS[word] ?? word.replace(/ieth$/, "y").replace(/th$/, ""));
  let value = 0;
  for (const word of words) {
    const unit = UNITS.indexOf(word);
    const ten = TENS.indexOf(word);
    if (unit >= 0) value += unit;
    else if (ten >= 2) value += ten * 10;
    else if (word === "hundred") value = (value || 1) * 100;
    else return null;
  }
  return value;
}

const NUMBER_WORD = `(?:${[...TENTHS, ...Object.keys(ORDINALS), ...UNITS, ...TENS.filter(Boolean), "hundred"].join("|")})(?:th)?`;
const WORD_NUMBER = new RegExp(`\\b${NUMBER_WORD}(?:[\\s-]+${NUMBER_WORD})*\\b`, "gi");
/** Too common as words ("one of the…", "a second pass") to hold the prose to. */
const NOT_FIGURES = new Set([0, 1, 2]);

/** The figures a text states — digits (with thousands separators, decimals, ordinal suffixes, `k`) and number words. */
export function figuresIn(text: string): { said: string; value: number }[] {
  const found: { said: string; value: number }[] = [];
  const prose = text.replace(/`[^`]*`/g, " ").replace(/\b[\w.-]+\/[\w.-]+\b/g, " ");
  for (const match of prose.matchAll(/(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(k\b|st\b|nd\b|rd\b|th\b)?/gi)) {
    const value = Number(match[1].replace(/,/g, "")) * (match[2]?.toLowerCase() === "k" ? 1000 : 1);
    if (!NOT_FIGURES.has(value)) found.push({ said: match[0], value });
  }
  for (const match of prose.matchAll(WORD_NUMBER)) {
    const value = wordNumber(match[0]);
    if (value !== null && !NOT_FIGURES.has(value)) found.push({ said: match[0], value });
  }
  return found;
}

/** Every number the material contains: its numeric fields, and every run of digits in its strings (dates included). */
export function materialNumbers(material: unknown): Set<number> {
  const numbers = new Set<number>();
  const walk = (value: unknown) => {
    if (typeof value === "number") numbers.add(value);
    else if (typeof value === "string") for (const digits of value.match(/\d+(?:\.\d+)?/g) ?? []) numbers.add(Number(digits));
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(material);
  // Shares as percentages, and hours on a 12-hour clock ("2 p.m." for 14).
  for (const n of [...numbers]) {
    if (n > 0 && n < 1) numbers.add(Math.round(n * 100));
    if (Number.isInteger(n) && n >= 13 && n <= 23) numbers.add(n - 12);
  }
  return numbers;
}

/** Figures the text states that the material doesn't contain. A `k` figure counts when it rounds a material number. */
export function ungroundedFigures(text: string, material: unknown): { checked: number; unmatched: string[] } {
  const known = materialNumbers(material);
  const figures = figuresIn(text);
  const near = (value: number) => value >= 1000 && [...known].some((n) => Math.abs(n - value) / value < 0.05);
  const unmatched = figures.filter((f) => !known.has(f.value) && !near(f.value)).map((f) => f.said);
  return { checked: figures.length, unmatched: [...new Set(unmatched)] };
}

/** `owner/name` mentions the material doesn't name. */
export function unknownRepos(text: string, material: unknown): { checked: number; unmatched: string[] } {
  const named = new Set((JSON.stringify(material).match(/[\w.-]+\/[\w.-]+/g) ?? []).map((name) => name.toLowerCase()));
  const mentions = [...new Set((text.match(/\b[A-Za-z0-9][\w.-]*\/[\w.-]*[A-Za-z0-9]\b/g) ?? []).filter((m) => !/^\d+\/\d+$/.test(m) && !/^(and|or|in|on)\//i.test(m)))];
  return { checked: mentions.length, unmatched: mentions.filter((m) => !named.has(m.toLowerCase())) };
}

/** The same bands the writer is given (`LENGTH_BANDS`, `period-post`), as numbers. */
export const WORD_BANDS: Record<LengthTier, readonly [number, number]> = {
  short: [60, 120],
  medium: [150, 300],
  long: [350, 600],
};

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

/** 1 inside the band, falling off linearly to 0 at half the minimum or twice the maximum. */
export function lengthFit(words: number, tier: LengthTier): number {
  const [min, max] = WORD_BANDS[tier];
  if (words >= min && words <= max) return 1;
  if (words < min) return Math.max(0, (words - min / 2) / (min / 2));
  return Math.max(0, 1 - (words - max) / max);
}

const STYLE_RULES: [string, RegExp][] = [
  ['calls the author "the user"', /\bthe user\b/i],
  ["names its material", /\b(the|this) (material|dossier|data provided|json)\b|\baccording to the (material|data)\b/i],
  ["names the kind of section", /\b(this|the) (section|round-?up|reading list)\b/i],
  ["echoes a heading", /^\s*(#{1,6}\s|\*\*[^*\n]+\*\*\s*$)/m],
  ["writes a table or chart", /^\s*\|.*\|\s*$|```/m],
  ["works out an interval", /\b(two|three|four|five|six|a few|several) days (later|after|before|earlier)\b/i],
];

/** The house rules the prose breaks. */
export function styleBreaches(text: string): string[] {
  return STYLE_RULES.filter(([, rule]) => rule.test(text)).map(([name]) => name);
}
