/* eslint-disable @next/next/no-img-element */
/**
 * The edition's own front-page cover illustration, when it has one. Rendered
 * identically by every `IssueV*` layout, right after their nav — renders
 * nothing until an edition actually has a `coverImage` URL.
 */

import type { IssueView } from "@/components/issue/types";

export default function IssueCoverBanner({ issue }: { issue: IssueView }) {
  if (!issue.coverImage) return null;
  return (
    <figure className="mb-8 grayscale hover:grayscale-0 transition-all duration-700">
      <img
        src={issue.coverImage}
        alt={`Cover illustration for ${issue.title}`}
        className="w-full h-auto object-cover border border-stone-300 p-1 bg-white"
      />
    </figure>
  );
}
