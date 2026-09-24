"use client";

/**
 * Finds every `.article-chart` placeholder `@/lib/markdown` left inside an
 * article body (one per valid ` ```chart ` block — see `@/lib/article-chart`
 * for the JSON contract) and draws it with Chart.js. Client-side by
 * necessity: Chart.js draws to `<canvas>`, which needs a browser, unlike the
 * rest of the article body, which is plain server-rendered HTML.
 *
 * Takes a ref to the content container rather than querying `document`
 * directly, so it only ever touches this one article's placeholders even if
 * something else on the page also renders markdown.
 */

import { useEffect, type RefObject } from "react";
import {
  Chart,
  BarController,
  LineController,
  DoughnutController,
  BarElement,
  LineElement,
  ArcElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Legend,
  Tooltip,
  type ChartConfiguration,
} from "chart.js";
import { parseArticleChartSpec } from "@/lib/article-chart";

Chart.register(
  BarController,
  LineController,
  DoughnutController,
  BarElement,
  LineElement,
  ArcElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Legend,
  Tooltip,
);

/** Ink-on-paper palette, matching `globals.css`'s `.article-body` typography rather than Chart.js's default rainbow. */
const INK = "#1a1a1a";
const INK_LIGHT = "#4a4a4a";
const GRID = "#d6d3cd";
/** Matches `.article-body .article-chart`'s `background` in `globals.css`, so doughnut slice gaps blend into the chart card rather than showing a mismatched seam. */
const CHART_BG = "#fdfcf9";

/**
 * Ordered for luma spread (near-black through warm mid-grey) so series stay
 * distinguishable even in grayscale print, not just distinct in hue —
 * consecutive entries alternate dark/light rather than drifting monotonically.
 */
const ARTICLE_CHART_PALETTE = ["#1a1a1a", "#3b3269", "#8a3b2b", "#b8862e", "#4a5a4a", "#8a8478"];
const PALETTE = ARTICLE_CHART_PALETTE;

/** Cycled by dataset index on multi-series line charts so lines stay distinguishable without relying on color alone. */
const LINE_DASH_PATTERNS: number[][] = [[], [6, 3], [2, 2], [8, 3, 2, 3]];
const LINE_POINT_STYLES: NonNullable<ChartConfiguration<"line">["data"]["datasets"][number]["pointStyle"]>[] = [
  "circle",
  "triangle",
  "rect",
  "crossRot",
];

function decodeSpec(encoded: string) {
  try {
    const json = atob(encoded);
    return parseArticleChartSpec(json);
  } catch {
    return null;
  }
}

export default function ArticleCharts({ containerRef }: { containerRef: RefObject<HTMLElement | null> }) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const placeholders = container.querySelectorAll<HTMLElement>(".article-chart[data-chart]");
    const charts: Chart[] = [];

    placeholders.forEach((placeholder) => {
      const encoded = placeholder.dataset.chart;
      if (!encoded) return;
      const spec = decodeSpec(encoded);
      if (!spec) return;

      const canvas = document.createElement("canvas");
      placeholder.replaceChildren(canvas);

      const isDoughnut = spec.type === "doughnut";
      const isLine = spec.type === "line";

      const config: ChartConfiguration = {
        type: spec.type,
        data: {
          labels: spec.labels,
          datasets: spec.datasets.map((dataset, i) => {
            const color = PALETTE[i % PALETTE.length];
            return {
              label: dataset.label,
              data: dataset.data,
              // Doughnut segments are colored per data point, not per dataset.
              backgroundColor: isDoughnut
                ? dataset.data.map((_, j) => PALETTE[j % PALETTE.length])
                : spec.type === "bar"
                  ? color
                  : "transparent",
              borderColor: isDoughnut ? CHART_BG : color,
              borderWidth: isDoughnut ? 1 : 2,
              // Multi-series lines vary dash pattern + point shape too, so they stay
              // distinguishable without relying on color alone.
              borderDash: isLine ? LINE_DASH_PATTERNS[i % LINE_DASH_PATTERNS.length] : undefined,
              pointRadius: isLine ? 3 : 0,
              pointStyle: isLine ? LINE_POINT_STYLES[i % LINE_POINT_STYLES.length] : undefined,
              pointBackgroundColor: color,
            };
          }),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          color: INK,
          font: { family: "'Libre Franklin', sans-serif" },
          plugins: {
            title: spec.title
              ? { display: true, text: spec.title, color: INK, font: { family: "'Playfair Display', serif", size: 15, weight: "bold" } }
              : { display: false },
            legend: {
              display: isDoughnut || spec.datasets.length > 1,
              labels: { color: INK_LIGHT, font: { family: "'Libre Franklin', sans-serif" } },
            },
          },
          scales: isDoughnut
            ? undefined
            : {
                x: { ticks: { color: INK_LIGHT }, grid: { color: GRID } },
                y: { ticks: { color: INK_LIGHT }, grid: { color: GRID }, beginAtZero: true },
              },
        },
      };

      charts.push(new Chart(canvas, config));
    });

    return () => {
      charts.forEach((chart) => chart.destroy());
    };
  }, [containerRef]);

  return null;
}
