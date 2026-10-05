"use client";

/**
 * Copy / Download / Share for the finished front page, as a PNG rendered
 * from the live DOM by `html-to-image` (no browser API rasterizes an
 * arbitrary subtree on its own).
 *
 * Every image on the page must be CORS-clean or the canvas taints and the
 * export breaks — GitHub's OG cards send `access-control-allow-origin: *`
 * and every `<img>` carries `crossOrigin="anonymous"`; the Google Fonts
 * stylesheet is fetched and inlined by `html-to-image` itself, limited to
 * the families the page actually uses.
 *
 * Each action is a real capability check, never assumed:
 *   - Copy needs `ClipboardItem` (missing in some Firefox versions) — falls
 *     back to a download, and says so.
 *   - Share needs `navigator.canShare({ files })` (the OS share sheet) —
 *     hidden otherwise. There is deliberately no "share to X" button: this
 *     product hosts nothing, so there's no URL to hand a share-intent link,
 *     and those links can't carry an image file.
 *
 * The last rendered PNG is kept until the page changes (`version`): Share
 * must run inside the click's user activation, which a multi-second render
 * can outlast — reusing that blob makes a retry instant. Copy and Download
 * always render fresh.
 */

import { useEffect, useRef, useState, type RefObject } from "react";
import { Chart } from "chart.js";
import { getFontEmbedCSS, toCanvas } from "html-to-image";
import EditionMasthead, { type EditionMastheadInfo } from "@/components/EditionMasthead";
import { withNaturalHeights } from "@/lib/export-style";
import { track } from "@/lib/track";

/** `paper` in tailwind.config.ts. */
const PAPER = "#f4f1ea";

const BUTTON =
  "font-sans text-xs font-bold uppercase tracking-widest text-ink border border-ink px-4 py-2 hover:bg-ink hover:text-white transition-colors disabled:opacity-40 disabled:pointer-events-none";

/** Margin of paper around the exported page, in CSS px — the live page gets it from `<main>`'s padding. */
const MARGIN = 40;

/** Same exclusion the print stylesheet makes. */
const skipNoPrint = (el: HTMLElement) => !(el instanceof HTMLElement && el.classList.contains("no-print"));

/**
 * Pixels per CSS pixel, best first. The page's smallest type is 9px, so the
 * image has to hold up when zoomed in: 4× where the canvas allows it. A
 * canvas past ~16k px a side or ~120M px in all fails to render in Chrome and
 * Safari, so a very long page steps down (`pixelRatios`).
 */
const PIXEL_RATIOS = [4, 3, 2];
const MAX_SIDE_PX = 16_000;
const MAX_AREA_PX = 120_000_000;

/** The ratios of `PIXEL_RATIOS` a page of this CSS size fits in, best first (1 when none do). */
function pixelRatios(cssWidth: number, cssHeight: number): number[] {
  const fits = (r: number) => r * cssWidth <= MAX_SIDE_PX && r * cssHeight <= MAX_SIDE_PX && r * r * cssWidth * cssHeight <= MAX_AREA_PX;
  const ok = PIXEL_RATIOS.filter(fits);
  return ok.length > 0 ? ok : [1];
}

/**
 * The inlined `@font-face` CSS (fonts as data URLs), built once per page
 * load and reused by every export — it's the slow part of a render (one
 * fetch per font file). Built from the masthead *and* the issue, since
 * `getFontEmbedCSS` only inlines the families a node actually uses: the
 * masthead guarantees the blackletter face, the issue the text faces every
 * layout shares, so the set holds across layout switches.
 */
let fontCss: Promise<string> | null = null;

function embeddedFonts(nodes: HTMLElement[]): Promise<string> {
  fontCss ??= (async () => {
    // Web fonts still loading would be missing from the page's font rules and fall back to a wider face.
    await document.fonts?.ready;
    const css = (await Promise.all(nodes.map((node) => getFontEmbedCSS(node, { filter: skipNoPrint })))).join("\n");
    if (!css.includes("@font-face")) throw new Error("The page's fonts couldn't be embedded — try again in a moment.");
    return css;
  })().catch((error) => {
    fontCss = null;
    throw error;
  });
  return fontCss;
}

/**
 * The masthead (rendered off-screen, see below) stacked over the issue,
 * with a paper margin, as one PNG. Captured separately and composed on a
 * canvas because the masthead has to stay invisible on the live page —
 * `html-to-image` copies computed styles, so a hidden element would export
 * hidden too; only the capture root's own style can be overridden, which is
 * what pulls the off-screen masthead back to the origin.
 */
async function renderPng(issue: HTMLElement, masthead: HTMLElement, ratio: number): Promise<Blob> {
  const width = Math.ceil(issue.getBoundingClientRect().width);
  masthead.style.width = `${width}px`;
  const fontEmbedCSS = await embeddedFonts([masthead, issue]);
  const common = { backgroundColor: PAPER, pixelRatio: ratio, filter: skipNoPrint, fontEmbedCSS, width };

  const head = await toCanvas(masthead, {
    ...common,
    height: Math.ceil(masthead.getBoundingClientRect().height),
    style: { position: "static", left: "0", top: "0", margin: "0" },
  });
  const body = await toCanvas(issue, {
    ...common,
    height: Math.ceil(issue.getBoundingClientRect().height),
    style: { margin: "0" },
  });

  const margin = MARGIN * ratio;
  const canvas = document.createElement("canvas");
  canvas.width = body.width + margin * 2;
  canvas.height = head.height + body.height + margin * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The page couldn't be rendered to an image.");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(head, margin, margin);
  ctx.drawImage(body, margin, margin + head.height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The page couldn't be rendered to an image.");
  return blob;
}

/**
 * Charts are canvases, drawn at the screen's pixel density; copied into the
 * export as they are they'd be a blur next to its crisp type. So for the
 * length of a render each is redrawn at the export's density.
 */
async function withSharpCharts<T>(ratio: number, run: () => Promise<T>): Promise<T> {
  const charts = Object.values(Chart.instances);
  const before = charts.map((chart) => chart.options.devicePixelRatio);
  for (const chart of charts) {
    chart.options.devicePixelRatio = ratio;
    chart.resize();
  }
  try {
    return await run();
  } finally {
    charts.forEach((chart, i) => {
      chart.options.devicePixelRatio = before[i];
      chart.resize();
    });
  }
}

/** The page as a PNG at the best pixel ratio the browser can render, stepping down if one fails. */
async function renderSharpPng(issue: HTMLElement, masthead: HTMLElement): Promise<Blob> {
  const cssWidth = Math.ceil(issue.getBoundingClientRect().width) + MARGIN * 2;
  const cssHeight = Math.ceil(issue.getBoundingClientRect().height + masthead.getBoundingClientRect().height) + MARGIN * 2;
  const ratios = pixelRatios(cssWidth, cssHeight);
  let failure: unknown;
  for (const ratio of ratios) {
    try {
      return await withSharpCharts(ratio, () => renderPng(issue, masthead, ratio));
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export default function ExportActions({
  targetRef,
  filename,
  title,
  edition,
  version,
}: {
  targetRef: RefObject<HTMLElement | null>;
  filename: string;
  title: string;
  /** What the exported masthead prints above the issue. */
  edition: EditionMastheadInfo;
  /** Changes whenever the rendered page does — drops the cached PNG. */
  version: string;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [canShareFiles, setCanShareFiles] = useState(false);
  const cached = useRef<Promise<Blob> | null>(null);
  const mastheadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    cached.current = null;
  }, [version]);

  // Feature-detected after mount — `navigator` doesn't exist during SSR.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const probe = new File([new Blob()], "probe.png", { type: "image/png" });
      setCanShareFiles(typeof navigator.share === "function" && !!navigator.canShare?.({ files: [probe] }));
    } catch {
      setCanShareFiles(false);
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  /** A fresh render (kept as the cache), or — for Share's retry — the cached one when there is one. */
  function png(reuse = false): Promise<Blob> {
    const node = targetRef.current;
    const masthead = mastheadRef.current;
    if (!node || !masthead) return Promise.reject(new Error("Nothing to export yet."));
    if (!reuse || !cached.current) {
      cached.current = withNaturalHeights(() => renderSharpPng(node, masthead));
      cached.current.catch(() => {
        cached.current = null;
      });
    }
    return cached.current;
  }

  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    setNotice(null);
    try {
      setNotice(await action());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const onDownload = () =>
    run(async () => {
      track("export", { action: "download" });
      downloadBlob(await png(), filename);
      return null;
    });

  const onCopy = () =>
    run(async () => {
      track("export", { action: "copy" });
      if (typeof window.ClipboardItem === "undefined" || !navigator.clipboard?.write) {
        downloadBlob(await png(), filename);
        return "Your browser can't copy images — downloaded it instead.";
      }
      // A promise-valued ClipboardItem, created synchronously in the click:
      // Safari rejects a clipboard write that happens after an await.
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png() })]);
      return "Copied — paste it wherever you like.";
    });

  const onShare = () =>
    run(async () => {
      track("export", { action: "share" });
      const file = new File([await png(true)], filename, { type: "image/png" });
      try {
        await navigator.share({ files: [file], title, text: title });
        return null;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return null;
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          return "The image took a moment to prepare — press Share again.";
        }
        throw error;
      }
    });

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Off-screen, never display:none — it must lay out and load its font to be captured. */}
      <div ref={mastheadRef} aria-hidden className="fixed top-0 left-[-100000px] bg-paper pointer-events-none">
        <EditionMasthead edition={edition} />
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={onCopy} disabled={busy} className={BUTTON}>
          Copy Image
        </button>
        <button type="button" onClick={onDownload} disabled={busy} className={BUTTON}>
          Download
        </button>
        {canShareFiles && (
          <button type="button" onClick={onShare} disabled={busy} className={BUTTON}>
            Share
          </button>
        )}
      </div>
      <p className="font-body text-xs text-stone-500 italic text-center max-w-xl" data-export-notice>
        {busy
          ? "Setting the page in type…"
          : notice ??
            (canShareFiles
              ? "Share hands the image to your device's share sheet. Nothing is hosted, so there's no link to post — attach the image instead."
              : "Nothing is hosted, so there's no link to post — copy or download the image and attach it wherever you share.")}
      </p>
    </div>
  );
}
