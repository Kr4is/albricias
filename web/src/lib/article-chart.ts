/**
 * Shared contract for the `chart` fenced-code convention a generation
 * prompt can use to ask for a real chart instead of prose or a table (see
 * `CHART_CLAUSE` in `@/mastra/agents`) — a single JSON object describing
 * bar/line/doughnut data, which `@/lib/markdown` turns into a placeholder
 * `<div>` and `@/components/ArticleCharts` (client-side, Chart.js) turns
 * into a canvas.
 *
 * Split out from both of those so the exact shape is validated identically
 * on the way in (server, at render time — a malformed block degrades to a
 * plain code block rather than breaking the page) and read identically on
 * the way out (client, when the chart actually draws).
 */

import type { RepoFactsBundle } from "@/lib/sources/github-repo-facts";

export interface ArticleChartSpec {
  type: "bar" | "line" | "doughnut";
  title?: string;
  labels: string[];
  datasets: Array<{ label: string; data: number[] }>;
}

/** `JSON.parse` a `chart` code block's text, or `null` if it doesn't match {@link ArticleChartSpec}. */
export function parseArticleChartSpec(raw: string): ArticleChartSpec | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;

  if (obj.type !== "bar" && obj.type !== "line" && obj.type !== "doughnut") return null;
  if (!Array.isArray(obj.labels) || obj.labels.length === 0) return null;
  if (!obj.labels.every((label) => typeof label === "string")) return null;
  const labels = obj.labels as string[];
  if (!Array.isArray(obj.datasets) || obj.datasets.length === 0) return null;

  const datasetsValid = obj.datasets.every((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const dataset = entry as Record<string, unknown>;
    return (
      typeof dataset.label === "string" &&
      Array.isArray(dataset.data) &&
      dataset.data.length === labels.length &&
      (dataset.data as unknown[]).every((n) => typeof n === "number" && Number.isFinite(n))
    );
  });
  if (!datasetsValid) return null;

  return {
    type: obj.type,
    title: typeof obj.title === "string" ? obj.title : undefined,
    labels,
    datasets: obj.datasets as ArticleChartSpec["datasets"],
  };
}

/**
 * Builds up to 3 chart specs straight from a repo's hard facts, bypassing
 * the LLM `chart` fenced-code convention entirely — used where the pipeline
 * wants a guaranteed, non-hallucinated chart from data it already fetched
 * rather than trusting a generation agent to transcribe it faithfully.
 *
 * Only emits a spec when its underlying data actually exists; never pads
 * with zeros or fabricated series.
 */
export function buildFactsChartSpecs(facts: RepoFactsBundle): ArticleChartSpec[] {
  const specs: ArticleChartSpec[] = [];

  if (facts.languages.length > 0) {
    specs.push({
      type: "doughnut",
      title: "Language breakdown",
      labels: facts.languages.map((lang) => lang.name),
      datasets: [
        {
          label: "Share",
          data: facts.languages.map((lang) => Math.round(lang.pct * 10) / 10),
        },
      ],
    });
  }

  if (facts.weeklyCommits && facts.weeklyCommits.length > 0) {
    const recent = facts.weeklyCommits.slice(-26);
    const labels = recent.map((_, i) => `W-${recent.length - i}`);
    specs.push({
      type: "line",
      title: "Commit activity (last 26 weeks)",
      labels,
      datasets: [{ label: "Commits", data: recent }],
    });
  }

  // Gated on the explicit "did `repos.get` succeed" flag rather than on the
  // counts themselves: a failed metadata fetch leaves all three at their `0`
  // default, and a bar chart captioned "Repository stats" reading 0/0/0 asserts
  // fetched data that was never fetched. A repo that really does have zero
  // stars, forks and issues still gets the chart — that's real data.
  if (facts.metadataOk) {
    specs.push({
      type: "bar",
      title: "Repository stats",
      labels: ["Stars", "Forks", "Open issues"],
      datasets: [{ label: "Count", data: [facts.stars, facts.forks, facts.openIssues] }],
    });
  }

  return specs;
}
