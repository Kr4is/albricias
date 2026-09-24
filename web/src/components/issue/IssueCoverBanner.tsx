"use client";
/* eslint-disable @next/next/no-img-element */
/**
 * The edition's own front-page cover — GitHub's social-preview card for the
 * period's most active repository. Rendered identically by every `IssueV*`
 * layout, first thing on the page — renders nothing until an edition
 * actually has a `coverImage` URL, and removes itself if it fails to load.
 *
 * Capped at `max-w-5xl`: the card is 2:1, so full sheet width would make it
 * ~800px tall, and cropping it would cut off the repo name printed on it.
 */

import { useState } from "react";
import type { IssueView } from "@/components/issue/types";

export default function IssueCoverBanner({ issue }: { issue: IssueView }) {
  const [failed, setFailed] = useState(false);
  if (!issue.coverImage || failed) return null;
  return (
    <figure className="article-image mb-8 max-w-5xl mx-auto grayscale hover:grayscale-0 transition-all duration-700">
      <img
        src={issue.coverImage}
        alt={`Cover illustration for ${issue.title}`}
        crossOrigin="anonymous"
        loading="eager"
        onError={() => setFailed(true)}
        className="w-full h-auto object-cover border border-stone-300 p-1 bg-white"
      />
    </figure>
  );
}
