/**
 * What an article carries besides its prose — as data, not markdown to
 * parse back: its picture, and structured blocks (a chart, a row of facts,
 * a list of repositories) the page renders itself (`ArticleBody`). The
 * computed boxes are made of these alone, and a written section gets its
 * charts and picture from the workflow's `illustrate` step, never from the
 * model — so every figure on the page comes from the dossier.
 *
 * The zod schemas are what the workflow's steps declare (and Studio shows);
 * the page only imports the types.
 */

import { z } from "zod";

export const chartSpecSchema = z.object({
  type: z.enum(["bar", "line", "doughnut", "polarArea"]),
  title: z.string(),
  labels: z.array(z.string()),
  datasets: z.array(z.object({ label: z.string(), data: z.array(z.number()) })),
  /** Bars run left to right — for long labels, like repository names. */
  horizontal: z.boolean().optional(),
  /** Datasets stack into one bar per label. */
  stacked: z.boolean().optional(),
  /** A logarithmic value axis — for values spanning orders of magnitude. */
  logScale: z.boolean().optional(),
  /** What the values count, for the tooltip ("commits"). */
  unit: z.string().optional(),
  /** One line under the chart: what it shows, or where the figures come from. */
  caption: z.string().optional(),
});
export type ChartSpec = z.infer<typeof chartSpecSchema>;

export const factSchema = z.object({ label: z.string(), value: z.string(), note: z.string().optional() });
export type Fact = z.infer<typeof factSchema>;

export const repoCardSchema = z.object({
  name: z.string().describe("owner/name"),
  url: z.string(),
  description: z.string().nullable(),
  language: z.string().nullable(),
  stars: z.number().nullable(),
  forks: z.number().nullable(),
  topics: z.array(z.string()),
  /** When it was starred, for the stars box. */
  starredOn: z.string().nullable(),
});
export type RepoCard = z.infer<typeof repoCardSchema>;

export const articleBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("chart"), chart: chartSpecSchema }),
  z.object({ type: z.literal("facts"), items: z.array(factSchema) }),
  z.object({ type: z.literal("repos"), items: z.array(repoCardSchema) }),
]);
export type ArticleBlock = z.infer<typeof articleBlockSchema>;

export const articleImageSchema = z.object({
  /** Same-origin, through the image proxy (`/api/image`). */
  src: z.string(),
  alt: z.string(),
  /** The image's own description (its alt text in the README), when it says something. */
  caption: z.string().nullable(),
  /** `contain` for a logo, which a crop would cut; `cover` for a screenshot or banner. */
  fit: z.enum(["cover", "contain"]),
});
export type ArticleImageRef = z.infer<typeof articleImageSchema>;
