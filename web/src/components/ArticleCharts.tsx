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
  BarElement,
  LineElement,
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
  BarElement,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Legend,
  Tooltip,
);

/** Ink-on-paper palette, matching `globals.css`'s `.content-body` typography rather than Chart.js's default rainbow. */
const INK = "#1a1a1a";
const INK_LIGHT = "#4a4a4a";
const GRID = "#d6d3cd";
const PALETTE = ["#1a1a1a", "#8a6d3b", "#4a4a4a", "#b8b2a4"];

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

      const config: ChartConfiguration = {
        type: spec.type,
        data: {
          labels: spec.labels,
          datasets: spec.datasets.map((dataset, i) => ({
            label: dataset.label,
            data: dataset.data,
            backgroundColor: spec.type === "bar" ? PALETTE[i % PALETTE.length] : "transparent",
            borderColor: PALETTE[i % PALETTE.length],
            borderWidth: 2,
            pointRadius: spec.type === "line" ? 3 : 0,
            pointBackgroundColor: PALETTE[i % PALETTE.length],
          })),
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
              display: spec.datasets.length > 1,
              labels: { color: INK_LIGHT, font: { family: "'Libre Franklin', sans-serif" } },
            },
          },
          scales: {
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
