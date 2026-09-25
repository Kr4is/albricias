"use client";
/* eslint-disable @next/next/no-img-element */
/**
 * An article's picture — one its repository shows of itself (a README
 * screenshot or diagram, its social preview, its website's), served
 * through the app's image proxy — in the paper's vintage treatment
 * (grayscale until hovered, bordered print plate), with its own
 * description as the caption when it has one. A logo — or any picture
 * that turns out not to be landscape once it loads — is shown whole
 * (`contain`) rather than cropped to the plate's 2:1. A failed load removes the figure
 * entirely rather than leaving a broken-image icon on the page.
 *
 * Same-origin, so the PNG export can embed it.
 */

import { useState } from "react";

import type { ArticleImageRef } from "@/lib/article-blocks";

/** Narrower than this (width ÷ height), a crop to 2:1 would cut away too much of the picture. */
const MIN_COVER_RATIO = 1.5;

export default function ArticleImage({
  image,
  eager = false,
  className = "",
}: {
  image: ArticleImageRef | null | undefined;
  /** Lead-story images load eagerly; everything below the fold stays lazy. */
  eager?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [narrow, setNarrow] = useState(false);
  if (!image || failed) return null;
  const contain = image.fit === "contain" || narrow;
  return (
    <figure className={`article-image grayscale hover:grayscale-0 transition-all duration-700 ${className}`}>
      <img
        src={image.src}
        alt={image.alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        onError={() => setFailed(true)}
        onLoad={(event) => setNarrow(event.currentTarget.naturalWidth < event.currentTarget.naturalHeight * MIN_COVER_RATIO)}
        className={`w-full aspect-[2/1] border border-stone-300 p-1 bg-white ${contain ? "object-contain" : "object-cover"}`}
      />
      {image.caption && <figcaption className="article-image-caption">{image.caption}</figcaption>}
    </figure>
  );
}
