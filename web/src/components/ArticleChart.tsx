"use client";

/**
 * One chart (`ChartSpec`, `@/lib/article-blocks`) drawn with Chart.js, in
 * the paper's ink-on-newsprint manner: its headline and caption set in the
 * page's own type (HTML, not canvas text), thin bars without vertical
 * rules, a filled line, a 24-hour rose, a doughnut with a hole. Every spec
 * comes from the chart desk (`@/lib/generation/charts`), computed from the
 * dossier — never from a model.
 */

import { useEffect, useRef } from "react";
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  LogarithmicScale,
  PointElement,
  PolarAreaController,
  RadialLinearScale,
  Tooltip,
  type ChartConfiguration,
  type ChartDataset,
} from "chart.js";

import type { ChartSpec } from "@/lib/article-blocks";

Chart.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  LogarithmicScale,
  PointElement,
  PolarAreaController,
  RadialLinearScale,
  Tooltip,
);

const INK = "#1a1a1a";
const INK_LIGHT = "#5a5650";
const RULE = "#e2ded6";
const PAPER = "#fdfcf9";
/** Ink, oxblood, ochre, sage, indigo, stone — distinct in hue and still apart in grayscale print. */
const PALETTE = ["#1a1a1a", "#8a3b2b", "#b8862e", "#4a5a4a", "#3b3269", "#8a8478"];
/** "Other" is always the quietest tone. */
const OTHER = "#cfc9be";
const SANS = "'Libre Franklin', sans-serif";

function colorFor(label: string, i: number): string {
  return label === "Other" ? OTHER : PALETTE[i % PALETTE.length];
}

/** Canvas height, in px at the base type size: enough per bar for a horizontal chart, fixed otherwise. */
function heightOf(spec: ChartSpec): number {
  if (spec.horizontal) return Math.max(140, spec.labels.length * 26 + 48);
  if (spec.type === "polarArea") return 280;
  if (spec.type === "doughnut") return 230;
  return 210;
}

function configOf(spec: ChartSpec): ChartConfiguration {
  const unit = spec.unit ? ` ${spec.unit}` : "";
  const tooltip = {
    backgroundColor: INK,
    titleFont: { family: SANS, size: 11 },
    bodyFont: { family: SANS, size: 11 },
    callbacks: {
      label: (item: { dataset: { label?: string }; formattedValue: string }) =>
        `${spec.datasets.length > 1 ? `${item.dataset.label}: ` : ""}${item.formattedValue}${unit}`,
    },
  };
  const legend = {
    display: spec.datasets.length > 1 || spec.type === "doughnut",
    position: "bottom" as const,
    labels: { color: INK_LIGHT, font: { family: SANS, size: 10 }, boxWidth: 10, boxHeight: 10, padding: 10 },
  };
  const base = { responsive: true, maintainAspectRatio: false, animation: false as const, color: INK, font: { family: SANS } };

  if (spec.type === "doughnut" || spec.type === "polarArea") {
    const round = spec.type === "polarArea";
    return {
      type: spec.type,
      data: {
        labels: spec.labels,
        datasets: spec.datasets.map((dataset) => ({
          label: dataset.label,
          data: dataset.data,
          // A rose is one series in one ink, its petals shaded by value; a doughnut, one tone per part.
          backgroundColor: round
            ? dataset.data.map((value) => `rgba(26, 26, 26, ${0.15 + 0.75 * (value / Math.max(1, ...dataset.data))})`)
            : spec.labels.map((label, j) => colorFor(label, j)),
          borderColor: PAPER,
          borderWidth: round ? 1 : 2,
        })),
      },
      options: {
        ...base,
        ...(round ? {} : { cutout: "58%" }),
        plugins: { legend: round ? { display: false } : { ...legend, position: "right" as const }, tooltip },
        scales: round
          ? {
              r: {
                ticks: { display: false },
                grid: { color: RULE },
                angleLines: { color: RULE },
                pointLabels: {
                  display: true,
                  centerPointLabels: true,
                  color: INK_LIGHT,
                  font: { family: SANS, size: 9 },
                  // Every third hour, so the clock reads without crowding.
                  callback: (label: string, i: number) => (i % 3 === 0 ? label : ""),
                },
              },
            }
          : undefined,
      },
    } as ChartConfiguration;
  }

  const line = spec.type === "line";
  const valueAxis = {
    type: spec.logScale ? ("logarithmic" as const) : ("linear" as const),
    beginAtZero: !spec.logScale,
    stacked: spec.stacked,
    grid: { color: RULE },
    border: { display: false },
    ticks: { color: INK_LIGHT, font: { family: SANS, size: 10 }, maxTicksLimit: 5, precision: 0 },
  };
  const categoryAxis = {
    stacked: spec.stacked,
    grid: { display: false },
    border: { color: INK },
    ticks: { color: INK_LIGHT, font: { family: SANS, size: 10 }, autoSkipPadding: 8, maxRotation: 0 },
  };
  return {
    type: spec.type,
    data: {
      labels: spec.labels,
      datasets: spec.datasets.map((dataset, i): ChartDataset<"bar" | "line"> => {
        const color = colorFor(dataset.label, i);
        return line
          ? {
              label: dataset.label,
              data: dataset.data,
              borderColor: color,
              backgroundColor: "rgba(26, 26, 26, 0.08)",
              fill: spec.datasets.length === 1 ? "origin" : false,
              borderWidth: 2,
              tension: 0.3,
              pointRadius: 3,
              pointBackgroundColor: PAPER,
              pointBorderColor: color,
              pointBorderWidth: 1.5,
            }
          : {
              label: dataset.label,
              data: dataset.data,
              backgroundColor: color,
              borderRadius: 1,
              barPercentage: 0.82,
              categoryPercentage: 0.86,
              maxBarThickness: 22,
            };
      }) as ChartDataset[],
    },
    options: {
      ...base,
      indexAxis: spec.horizontal ? "y" : "x",
      plugins: { legend, tooltip },
      scales: spec.horizontal ? { x: valueAxis, y: categoryAxis } : { x: categoryAxis, y: valueAxis },
    },
  } as ChartConfiguration;
}

export default function ArticleChart({ spec }: { spec: ChartSpec }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const chart = new Chart(canvas.current, configOf(spec));
    return () => chart.destroy();
  }, [spec]);

  return (
    <figure className="article-chart">
      <figcaption className="article-chart-title">{spec.title}</figcaption>
      {/* In em, so the chart grows with the page fill and the column balancer like the type around it. */}
      <div style={{ height: `${heightOf(spec) / 16}em` }}>
        <canvas ref={canvas} role="img" aria-label={spec.title} />
      </div>
      {spec.caption && <p className="article-chart-caption">{spec.caption}</p>}
    </figure>
  );
}
