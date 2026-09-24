"use client";
/* eslint-disable @next/next/no-img-element */
/**
 * An article's own photo — GitHub's preview card for the repo it's about —
 * in the paper's vintage treatment (grayscale until hovered, bordered print
 * plate), sized by the slot each `IssueV*` layout puts it in. A failed load (the OG endpoint 404s for a
 * private or renamed repo, or its rate limit runs out) removes the figure
 * entirely rather than leaving a broken-image icon on the page.
 *
 * `crossOrigin="anonymous"` is what keeps the page exportable: without it
 * the browser caches a non-CORS copy and `html-to-image` can't embed it.
 */

import { useState } from "react";

export default function ArticleImage({
  src,
  alt,
  eager = false,
  className = "",
}: {
  src: string | null | undefined;
  alt: string;
  /** Lead-story images load eagerly; everything below the fold stays lazy. */
  eager?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    <figure className={`article-image grayscale hover:grayscale-0 transition-all duration-700 ${className}`}>
      <img
        src={src}
        alt={alt}
        crossOrigin="anonymous"
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        onError={() => setFailed(true)}
        className="w-full aspect-[2/1] object-cover border border-stone-300 p-1 bg-white"
      />
    </figure>
  );
}
