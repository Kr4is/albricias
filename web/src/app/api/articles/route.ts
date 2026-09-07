/**
 * JSON API — ported from `app/routes/api.py` (`create_article`), the only
 * endpoint there. Bearer-token gated (`requireApiToken`), not session-gated —
 * `app/auth.py:20-36` shows the API used `require_api_token`, not
 * `login_required`, and this route lives outside `/admin/*` so `proxy.ts`'s
 * session-cookie guard never applies to it either.
 *
 * Like `admin.compose_article`, edition lookup/auto-creation is generalised
 * from `year`/`month` to the current cadence's period bounds around the
 * article's date.
 */

import { requireApiToken } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { EDITION_STATUS_DRAFT } from "@/lib/edition-helpers";
import { defaultEditionTitle, defaultEditionVol, getCadence, periodBoundsForDate } from "@/lib/cadence";
import { nextArticleOrder } from "@/lib/article-order";
import { parseDateInputValue } from "@/lib/date-input";

const REQUIRED_FIELDS = ["title", "content", "category", "date"] as const;

export async function POST(request: Request) {
  const denied = await requireApiToken(request);
  if (denied) return denied;

  let data: unknown;
  try {
    data = await request.json();
  } catch {
    data = null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return Response.json({ error: "No data provided" }, { status: 400 });
  }
  const body = data as Record<string, unknown>;

  for (const field of REQUIRED_FIELDS) {
    if (!(field in body)) {
      return Response.json({ error: `Missing field: ${field}` }, { status: 400 });
    }
  }

  const articleDate =
    typeof body.date === "string" ? parseDateInputValue(body.date) : null;
  if (!articleDate) {
    return Response.json({ error: "Invalid date format, use YYYY-MM-DD" }, { status: 400 });
  }

  const cadence = await getCadence();
  const period = periodBoundsForDate(cadence, articleDate);

  let edition = await prisma.edition.findUnique({
    where: { cadence_periodStart: { cadence, periodStart: period.periodStart } },
  });
  if (!edition) {
    const shape = { cadence, ...period };
    edition = await prisma.edition.create({
      data: {
        cadence,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        title: defaultEditionTitle(shape),
        vol: defaultEditionVol(shape),
        status: EDITION_STATUS_DRAFT,
      },
    });
  }

  const content = typeof body.content === "string" ? body.content : "";
  const article = await prisma.article.create({
    data: {
      editionId: edition.id,
      title: String(body.title),
      content,
      category: String(body.category),
      author: typeof body.author === "string" ? body.author : "Staff Writer",
      deck: content.charAt(0) || "A",
      order: await nextArticleOrder(edition.id),
      date: articleDate,
      sourceType: "manual",
    },
  });

  return Response.json(
    { message: "Article created", article_id: article.id, edition_id: edition.id },
    { status: 201 },
  );
}
