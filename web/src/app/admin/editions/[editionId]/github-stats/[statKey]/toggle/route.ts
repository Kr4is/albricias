/**
 * Mark/unmark toggle for one `githubStats` metric, keyed by the flat
 * dot-path key `edit/page.tsx`'s `GITHUB_STAT_SECTIONS` assigns it (e.g.
 * `"temporal.busiestDay"`) — part of the "GitHub Insights" curation UI (plan
 * Implementation Step 4).
 *
 * Updates only `Edition.curatorMarks.githubStatKeys`. Unlike the sibling
 * topic-candidate toggle, this never touches any `Article` — marking a raw
 * stats-bank metric is a pure annotation with no functional effect (plan
 * Acceptance Criteria A). `Edition.curatorMarks` is a new Prisma field
 * another worker adds in parallel; read/written here via `unknown` casts,
 * same defensive pattern `edit/page.tsx` uses for `generationProgress`.
 */

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { flashRedirect } from "@/lib/flash";

interface CuratorMarks {
  topicCandidateIds?: string[];
  githubStatKeys?: string[];
}

function readCuratorMarks(raw: string | null | undefined): CuratorMarks {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as CuratorMarks) : {};
  } catch {
    return {};
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ editionId: string; statKey: string }> },
) {
  const { editionId, statKey } = await params;
  const id = Number(editionId);
  const edition = await prisma.edition.findUnique({ where: { id } });
  if (!edition) return new Response("Not found", { status: 404 });

  const marks = readCuratorMarks(
    (edition as unknown as { curatorMarks?: string | null }).curatorMarks,
  );
  const current = marks.githubStatKeys ?? [];
  const isMarked = current.includes(statKey);
  const next = isMarked ? current.filter((key) => key !== statKey) : [...current, statKey];

  const nextMarks: CuratorMarks = { ...marks, githubStatKeys: next };

  await (
    prisma.edition.update as unknown as (args: {
      where: { id: number };
      data: { curatorMarks: string };
    }) => Promise<unknown>
  )({ where: { id }, data: { curatorMarks: JSON.stringify(nextMarks) } });

  return flashRedirect(request, `/admin/editions/${id}/edit`, [
    { type: "success", text: isMarked ? "Metric unmarked." : "Metric marked." },
  ]);
}
