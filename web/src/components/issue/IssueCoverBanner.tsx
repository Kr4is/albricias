/* eslint-disable @next/next/no-img-element */
/**
 * The edition's own front-page cover — an AI-generated illustration themed
 * on the month's articles as a whole (`generateEditionCoverImage()` in
 * `@/lib/ai/hero-image`, run once per edition after its articles are
 * written), not any single story's photo. Rendered identically by all five
 * `IssueV*` layouts, right after their nav, so every variant gets the same
 * "this issue" frontispiece regardless of which one a given month landed on
 * — renders nothing until an edition actually has one.
 */

import { mediaUrl } from "@/lib/media";
import type { IssueView } from "@/components/issue/types";

export default function IssueCoverBanner({ issue }: { issue: IssueView }) {
  if (!issue.coverImage) return null;
  return (
    <figure className="mb-8 grayscale hover:grayscale-0 transition-all duration-700">
      <img
        src={mediaUrl(issue.coverImage)}
        alt={`Cover illustration for ${issue.title}`}
        className="w-full h-auto object-cover border border-stone-300 p-1 bg-white"
      />
    </figure>
  );
}
