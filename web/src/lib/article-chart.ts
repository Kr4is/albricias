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
