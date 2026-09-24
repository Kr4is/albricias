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
import { getFontEmbedCSS, toBlob } from "html-to-image";

/** `paper` in tailwind.config.ts. */
const PAPER = "#f4f1ea";

const BUTTON =
  "font-sans text-xs font-bold uppercase tracking-widest text-ink border border-ink px-4 py-2 hover:bg-ink hover:text-white transition-colors disabled:opacity-40 disabled:pointer-events-none";

/** Margin of paper around the captured page, in CSS px — the live page gets it from `<main>`'s padding. */
const MARGIN = 40;

/** Same exclusion the print stylesheet makes. */
const skipNoPrint = (el: HTMLElement) => !(el instanceof HTMLElement && el.classList.contains("no-print"));

/**
 * The inlined `@font-face` CSS (fonts as data URLs), built once per page
 * load and reused by every export — it's the slow part of a render (one
 * fetch per font file), and the typefaces never change between exports.
 */
let fontCss: Promise<string> | null = null;

async function renderPng(node: HTMLElement): Promise<Blob> {
  fontCss ??= getFontEmbedCSS(node, { filter: skipNoPrint }).catch((error) => {
    fontCss = null;
    throw error;
  });
  const { width, height } = node.getBoundingClientRect();
  const blob = await toBlob(node, {
    backgroundColor: PAPER,
    pixelRatio: 2,
    filter: skipNoPrint,
    fontEmbedCSS: await fontCss,
    width: Math.ceil(width) + MARGIN * 2,
    height: Math.ceil(height) + MARGIN * 2,
    style: { padding: `${MARGIN}px`, boxSizing: "border-box", margin: "0" },
  });
  if (!blob) throw new Error("The page couldn't be rendered to an image.");
  return blob;
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
  version,
}: {
  targetRef: RefObject<HTMLElement | null>;
  filename: string;
  title: string;
  /** Changes whenever the rendered page does — drops the cached PNG. */
  version: string;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [canShareFiles, setCanShareFiles] = useState(false);
  const cached = useRef<Promise<Blob> | null>(null);

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
    if (!node) return Promise.reject(new Error("Nothing to export yet."));
    if (!reuse || !cached.current) {
      cached.current = renderPng(node);
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
      downloadBlob(await png(), filename);
      return null;
    });

  const onCopy = () =>
    run(async () => {
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
