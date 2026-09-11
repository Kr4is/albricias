/**
 * Edit edition metadata + manage its articles — ported from `admin.edition_edit`
 * (`app/routes/admin.py:243-270`) and `app/templates/admin/edition_edit.html`.
 *
 * The metadata form and the inline "add article" form each POST to their own
 * sibling route (`.../update`, `.../articles/add`) rather than back to this
 * page's own URL — see the Phase 3 notes for why (Next can't colocate a
 * `page.tsx` and a `route.ts` on the same path).
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import NewspaperShell from "@/components/NewspaperShell";
import FlashBanner from "@/components/admin/FlashBanner";
import { prisma } from "@/lib/prisma";
import { ARTICLE_ORDER } from "@/lib/editions";
import { EDITION_STATUS_DRAFT } from "@/lib/edition-helpers";
import { readFlash, type FlashMessage, type FlashType } from "@/lib/flash";
import { mediaUrl } from "@/lib/media";
import { toDateInputValue } from "@/lib/date-input";
import { ARTICLE_CATEGORIES } from "@/lib/article-categories";
import type { GithubStats } from "@/lib/github-stats";
import {
  isTopicCandidateMarked,
  parseStoredCuratorMarks,
  type CuratorMarks,
} from "@/lib/topic-candidates";
import type { TopicCandidate } from "@/lib/topic-candidates/types";
import GenerationWatcher, {
  type GenerationProgress,
  type GenerationSection,
} from "./GenerationWatcher";

export const dynamic = "force-dynamic";

/** Flask's `<int:...>` converter: digits only. */
function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

async function loadEdition(editionId: string) {
  const id = parseId(editionId);
  if (id === null) return null;
  return prisma.edition.findUnique({ where: { id } });
}

type LoadedEdition = NonNullable<Awaited<ReturnType<typeof loadEdition>>>;

/**
 * `Edition.generationProgress` (prisma/schema.prisma, Implementation Step 1)
 * is read here defensively via an `unknown` cast: this file was written
 * against the field as documented in the plan even though the migration
 * adding it may land slightly after this file during parallel
 * implementation. Once the generated Prisma client includes the column this
 * cast becomes a no-op (same shape either way).
 *
 * `messages` is `@/lib/generation`'s `GenerationProgress.messages` — the
 * warnings the background pipeline collected. It's declared here rather than
 * on `GenerationWatcher`'s copy of the type because the watcher's banner
 * doesn't render them; this page does (see {@link GenerationMessages}).
 */
function readGenerationProgress(
  edition: LoadedEdition,
): (GenerationProgress & { messages?: FlashMessage[] }) | null {
  const raw = (edition as unknown as { generationProgress?: string | null })
    .generationProgress;
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GenerationProgress & { messages?: FlashMessage[] };
  } catch {
    return null;
  }
}

/** `githubStatKeys` marking is a pure annotation with no default-visible semantics. */
function isGithubStatMarked(marks: CuratorMarks, key: string): boolean {
  return marks.githubStatKeys?.includes(key) ?? false;
}

function readGithubStats(edition: LoadedEdition): GithubStats | null {
  if (!edition.githubStats) return null;
  try {
    return JSON.parse(edition.githubStats) as GithubStats;
  } catch {
    return null;
  }
}

function readTopicCandidates(edition: LoadedEdition): TopicCandidate[] | null {
  if (!edition.topicCandidates) return null;
  try {
    const parsed: unknown = JSON.parse(edition.topicCandidates);
    return Array.isArray(parsed) ? (parsed as TopicCandidate[]) : null;
  } catch {
    return null;
  }
}

/**
 * Section/metric catalog for the "GitHub Insights" curation UI below —
 * mirrors `GithubStats`'s shape (`@/lib/github-stats/types.ts`) field for
 * field. Not derived dynamically from the type (no runtime reflection over a
 * TypeScript interface), so this list is the single source of truth for
 * which dot-path keys (e.g. `"temporal.busiestDay"`) can appear in
 * `Edition.curatorMarks.githubStatKeys` — keep it in sync if `GithubStats`
 * ever changes shape.
 */
const GITHUB_STAT_SECTIONS: ReadonlyArray<{
  section: keyof GithubStats;
  label: string;
  metrics: ReadonlyArray<{ key: string; label: string }>;
}> = [
  {
    section: "temporal",
    label: "Temporal",
    metrics: [
      { key: "busiestDay", label: "Busiest day" },
      { key: "mostProductiveHour", label: "Most productive hour" },
      { key: "preferredWeekday", label: "Preferred weekday" },
      { key: "timeOfDaySplit", label: "Time of day split" },
      { key: "longestStreakDays", label: "Longest streak (days)" },
      { key: "longestGapDays", label: "Longest gap (days)" },
      { key: "firstEventAt", label: "First event" },
      { key: "lastEventAt", label: "Last event" },
    ],
  },
  {
    section: "volume",
    label: "Volume",
    metrics: [
      { key: "totalCommits", label: "Total commits" },
      { key: "totalPrs", label: "Total PRs" },
      { key: "totalIssues", label: "Total issues" },
      { key: "totalReleases", label: "Total releases" },
      { key: "distinctRepos", label: "Distinct repos" },
      { key: "mostActiveRepo", label: "Most active repo" },
      { key: "newRepos", label: "New repos" },
      { key: "starredRepos", label: "Starred repos" },
    ],
  },
  {
    section: "collaboration",
    label: "Collaboration",
    metrics: [
      { key: "externalRepos", label: "External repos" },
      { key: "prsOpened", label: "PRs opened" },
      { key: "prsMerged", label: "PRs merged" },
      { key: "prsClosedUnmerged", label: "PRs closed unmerged" },
      { key: "avgPrLifetimeHours", label: "Avg PR lifetime (hrs)" },
      { key: "issuesOpened", label: "Issues opened" },
      { key: "issuesClosed", label: "Issues closed" },
      { key: "reviewsGiven", label: "Reviews given" },
      { key: "releasesPublished", label: "Releases published" },
    ],
  },
  {
    section: "content",
    label: "Content",
    metrics: [
      { key: "avgCommitMessageLength", label: "Avg commit message length" },
      { key: "conventionalCommitBreakdown", label: "Conventional commit breakdown" },
      { key: "shortestCommitMessage", label: "Shortest commit message" },
      { key: "longestCommitMessage", label: "Longest commit message" },
      { key: "mostUnusualCommitMessage", label: "Most unusual commit message" },
      { key: "mostUsedEmoji", label: "Most used emoji" },
    ],
  },
  {
    section: "language",
    label: "Language",
    metrics: [{ key: "topLanguagesByBytes", label: "Top languages by bytes" }],
  },
  {
    section: "trend",
    label: "Trend",
    metrics: [
      { key: "vsPreviousPeriod", label: "Vs previous period" },
      { key: "bestPeriodThisYear", label: "Best period this year" },
      { key: "consecutiveActivePeriods", label: "Consecutive active periods" },
    ],
  },
];

function getStatValue(stats: GithubStats, section: keyof GithubStats, key: string): unknown {
  const group = stats[section];
  if (group === null || typeof group !== "object") return group;
  return (group as unknown as Record<string, unknown>)[key];
}

/**
 * Best-effort human-readable rendering of one `GithubStats` leaf value —
 * covers the known nested shapes (`DayCount`, `HourCount`, `RepoCount`, …,
 * see `@/lib/github-stats/types.ts`) generically by duck-typing their fields,
 * rather than one bespoke formatter per metric.
 */
function formatStatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value || "—";
  if (Array.isArray(value)) {
    return value.length === 0 ? "—" : value.map((item) => formatStatValue(item)).join(", ");
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("date" in obj && "count" in obj) return `${obj.date} (${obj.count})`;
    if ("hour" in obj && "count" in obj) return `${obj.hour}:00 (${obj.count})`;
    if ("weekday" in obj && "count" in obj) return `${obj.weekday} (${obj.count})`;
    if ("repo" in obj && "count" in obj) return `${obj.repo} (${obj.count})`;
    if ("keyword" in obj && "count" in obj) return `${obj.keyword} (${obj.count})`;
    if ("emoji" in obj && "count" in obj) return `${obj.emoji} (${obj.count})`;
    if ("language" in obj && "bytes" in obj) return `${obj.language} (${obj.bytes}B)`;
    if ("morning" in obj && "afternoon" in obj && "evening" in obj) {
      return `morning ${obj.morning}, afternoon ${obj.afternoon}, evening ${obj.evening}, late night ${obj.lateNight}`;
    }
    if ("direction" in obj && "deltaContributions" in obj) {
      const pct = obj.deltaPercent === null ? "" : ` (${String(obj.deltaPercent)}%)`;
      return `${obj.direction} ${obj.deltaContributions}${pct}, was ${obj.previousTotalContributions}`;
    }
    if ("periodStart" in obj && "totalContributions" in obj) {
      const current = obj.isCurrentPeriod ? ", current" : "";
      return `${String(obj.periodStart)}: ${obj.totalContributions}${current}`;
    }
    return JSON.stringify(obj);
  }
  return String(value);
}

const GENERATION_MESSAGE_STYLES: Record<FlashType, string> = {
  success: "border-green-600 bg-green-50 text-green-900",
  error: "border-red-600 bg-red-50 text-red-900",
  warning: "border-amber-500 bg-amber-50 text-amber-900",
  info: "border-blue-500 bg-blue-50 text-blue-900",
};

/**
 * The 3 "source not configured/connected" messages (plan Implementation Step
 * 4, Acceptance Criteria C) — filtered out of this page's `GenerationMessages`
 * by exact text, matched verbatim against where they're pushed in
 * `@/lib/generation`'s `populateEditionDraft` (`index.ts:878-879` blog,
 * `index.ts:919-920` Spotify, `index.ts:957-958` Alexandria). They move to a
 * permanent connection-status view on `/admin/settings` instead. This is
 * fragile if that wording changes without updating this set (accepted risk,
 * per the plan) — every other message (AI failures, aborted sections, the
 * GitHub-not-configured warning) is unaffected and keeps showing here.
 */
const HIDDEN_GENERATION_MESSAGE_TEXTS = new Set<string>([
  "Blog RSS URL not configured (/admin/settings) — skipping blog fetch.",
  "Spotify not connected — visit /admin/spotify/connect to link your account.",
  "Alexandria API URL not configured (/admin/settings) — skipping Alexandria fetch.",
]);

/**
 * Warnings the "Generate edition" pipeline collected while running in the
 * background (`@/lib/generation`'s `populateEditionDraft`) — an AI provider
 * that failed at call time, a source that couldn't be fetched, a section that
 * was never written. Styled like `FlashBanner`, but deliberately not that
 * component: these come off the edition row rather than the URL, so none of
 * its query-param cleanup or first-non-empty capture applies (and sharing an
 * instance would let this text leak into the real flash slot).
 */
function GenerationMessages({ messages }: { messages: readonly FlashMessage[] }) {
  if (messages.length === 0) return null;
  return (
    <div className="mb-6 space-y-2">
      {messages.map((message, index) => (
        <div
          key={index}
          className={`px-4 py-3 text-sm font-sans border-l-4 ${GENERATION_MESSAGE_STYLES[message.type]}`}
        >
          {message.text}
        </div>
      ))}
    </div>
  );
}

type ArticleRow = Awaited<ReturnType<typeof prisma.article.findMany>>[number];

interface SectionRow {
  key: string;
  articles: ArticleRow[];
  placeholder: { kind: "writing" | "failed"; category: string } | null;
}

/**
 * Merge `generationProgress.sections` with the real, already-persisted
 * `Article`s so the "writing…" placeholder appears in the right spot and
 * disappears once the section's article(s) exist — see the plan's
 * Implementation Step 4. A category can have more than one real article
 * (an AI-written one plus a hand-added one sharing the same category), so
 * every matching article is grouped in, not just the first.
 */
function mergeSectionsWithArticles(
  sections: readonly GenerationSection[],
  allArticles: readonly ArticleRow[],
): { rows: SectionRow[]; remaining: ArticleRow[] } {
  const matchedIds = new Set<number>();
  const rows = sections.map((section, index) => {
    const matched = allArticles.filter((article) => article.category === section.category);
    matched.forEach((article) => matchedIds.add(article.id));
    const placeholder =
      matched.length > 0
        ? null
        : section.status === "writing"
          ? ({ kind: "writing", category: section.category } as const)
          : section.status === "aborted" || section.status === "failed"
            ? ({ kind: "failed", category: section.category } as const)
            : null;
    return { key: `section-${index}-${section.category}`, articles: matched, placeholder };
  });
  const remaining = allArticles.filter((article) => !matchedIds.has(article.id));
  return { rows, remaining };
}

/**
 * One article card — factored out so its markup is defined exactly once
 * (Principle 2 of the plan) even though it now renders from three different
 * call sites (grouped under a generation section, or trailing as a
 * not-yet-generated ranking article).
 */
function ArticleCard({ article, editionId }: { article: ArticleRow; editionId: number }) {
  return (
    <div className="border border-stone-200 hover:border-ink transition-colors p-4 flex items-start gap-4 bg-white">
      <div className="font-masthead text-3xl text-stone-300 leading-none shrink-0 w-8 text-center">
        {article.order}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className="text-[9px] font-sans font-bold uppercase tracking-widest bg-stone-100 px-1.5 py-0.5">
            {article.category}
          </span>
          {article.sourceType === "ai_generated" && (
            <span className="text-[9px] font-sans font-bold uppercase tracking-widest text-purple-600 bg-purple-50 px-1.5 py-0.5">
              AI
            </span>
          )}
          {article.date && (
            <span className="text-[9px] font-sans text-stone-400">
              {article.date.toLocaleDateString("en-US", {
                month: "short",
                day: "2-digit",
                timeZone: "UTC",
              })}
            </span>
          )}
        </div>
        <p className="font-headline font-bold text-base leading-tight truncate">
          {article.title}
        </p>
        <p className="text-xs font-sans text-stone-500 mt-0.5 line-clamp-1">
          {article.content.slice(0, 100)}...
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {article.sourceType === "ai_generated" && (
          <form
            method="POST"
            action={`/admin/editions/${editionId}/articles/${article.id}/regenerate`}
            data-loading-submit
          >
            <button
              type="submit"
              title="Regenerate with AI"
              className="p-1.5 text-purple-600 hover:bg-purple-50 transition-colors border border-purple-200"
            >
              <span className="material-icons text-sm">auto_awesome</span>
            </button>
          </form>
        )}
        <a
          href={`/admin/editions/${editionId}/articles/${article.id}/edit`}
          className="p-1.5 text-ink hover:bg-stone-100 transition-colors border border-stone-200"
        >
          <span className="material-icons text-sm">edit</span>
        </a>
        <form
          method="POST"
          action={`/admin/editions/${editionId}/articles/${article.id}/delete`}
          data-confirm="Delete this article?"
        >
          <button
            type="submit"
            className="p-1.5 text-red-500 hover:bg-red-50 transition-colors border border-red-100"
          >
            <span className="material-icons text-sm">delete</span>
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * One topic candidate card in the "GitHub Insights" section — title, bullets,
 * score, and a mark/unmark toggle. Unmarking hides (not deletes) whichever
 * `Article` this candidate auto-generated, via `sourceData.topicCandidateId`
 * (see `.../topic-candidates/[candidateId]/toggle/route.ts`).
 */
function TopicCandidateCard({
  candidate,
  marked,
  editionId,
}: {
  candidate: TopicCandidate;
  marked: boolean;
  editionId: number;
}) {
  return (
    <div
      className={`border p-4 ${marked ? "border-stone-200 bg-white" : "border-stone-200 bg-stone-50 opacity-60"}`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[9px] font-sans font-bold uppercase tracking-widest bg-stone-100 px-1.5 py-0.5">
            {candidate.kind}
          </span>
          <span className="text-[9px] font-sans text-stone-400">score {candidate.score}</span>
        </div>
        <form
          method="POST"
          action={`/admin/editions/${editionId}/topic-candidates/${candidate.id}/toggle`}
          className="shrink-0"
        >
          <button
            type="submit"
            className={`inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold font-sans uppercase tracking-widest border transition-colors ${
              marked
                ? "border-green-600 text-green-700 hover:bg-green-50"
                : "border-stone-300 text-stone-500 hover:bg-stone-100"
            }`}
          >
            <span className="material-icons text-xs">
              {marked ? "visibility" : "visibility_off"}
            </span>
            {marked ? "Marked" : "Unmarked"}
          </button>
        </form>
      </div>
      <p className="font-headline font-bold text-sm mb-1.5">{candidate.title}</p>
      <ul className="space-y-0.5">
        {candidate.bullets.map((bullet, index) => (
          <li key={index} className="text-xs font-sans text-stone-600">
            • {bullet}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One `githubStats` metric row — value plus its own mark/unmark toggle (a pure annotation, no article effect). */
function GithubStatRow({
  label,
  value,
  marked,
  editionId,
  statKey,
}: {
  label: string;
  value: unknown;
  marked: boolean;
  editionId: number;
  statKey: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-stone-100 last:border-0">
      <div className="min-w-0">
        <p className="text-[10px] font-sans font-bold uppercase tracking-widest text-stone-500">
          {label}
        </p>
        <p className="text-xs font-sans text-stone-700 truncate">{formatStatValue(value)}</p>
      </div>
      <form
        method="POST"
        action={`/admin/editions/${editionId}/github-stats/${statKey}/toggle`}
        className="shrink-0"
      >
        <button
          type="submit"
          title={marked ? "Unmark" : "Mark"}
          className={`p-1 border transition-colors ${
            marked
              ? "border-amber-500 text-amber-600 bg-amber-50"
              : "border-stone-200 text-stone-400 hover:bg-stone-100"
          }`}
        >
          <span className="material-icons text-sm">{marked ? "star" : "star_outline"}</span>
        </button>
      </form>
    </div>
  );
}

export async function generateMetadata({
  params,
}: PageProps<"/admin/editions/[editionId]/edit">): Promise<Metadata> {
  const { editionId } = await params;
  const edition = await loadEdition(editionId);
  return { title: edition ? `Edit Edition: ${edition.title} - Admin` : "Edition Not Found - Admin" };
}

export default async function EditionEditPage({
  params,
  searchParams,
}: PageProps<"/admin/editions/[editionId]/edit">) {
  const { editionId } = await params;
  const query = await searchParams;
  const messages = readFlash(query);

  const edition = await loadEdition(editionId);
  if (edition === null) notFound();

  const [articles, activityCount, recentActivities] = await Promise.all([
    prisma.article.findMany({ where: { editionId: edition.id }, orderBy: [...ARTICLE_ORDER] }),
    prisma.serviceActivity.count({ where: { editionId: edition.id } }),
    prisma.serviceActivity.findMany({
      where: { editionId: edition.id },
      take: 15,
      select: { eventType: true, title: true },
    }),
  ]);

  const defaultArticleDate = toDateInputValue(edition.periodStart);
  const coverSrc = mediaUrl(edition.coverImage);
  const generationProgress = readGenerationProgress(edition);
  const curatorMarks = parseStoredCuratorMarks(edition.curatorMarks);
  const githubStats = readGithubStats(edition);
  const topicCandidates = readTopicCandidates(edition);
  const { rows: sectionRows, remaining: remainingArticles } = generationProgress
    ? mergeSectionsWithArticles(generationProgress.sections, articles)
    : { rows: [] as SectionRow[], remaining: articles };
  const hasAnythingToShow =
    remainingArticles.length > 0 ||
    sectionRows.some((row) => row.articles.length > 0 || row.placeholder !== null);

  return (
    <NewspaperShell endpoint="admin.edition_edit">
      <div className="pb-16 fade-in">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs font-sans text-stone-500 mb-6">
          <a href="/admin/editions" className="hover:underline">
            Dashboard
          </a>
          <span className="material-icons text-xs">chevron_right</span>
          <span className="text-ink font-bold">{edition.title}</span>
        </div>

        <FlashBanner messages={messages} />

        <GenerationMessages
          messages={(generationProgress?.messages ?? []).filter(
            (message) => !HIDDEN_GENERATION_MESSAGE_TEXTS.has(message.text),
          )}
        />

        {edition.generationStatus === "running" && (
          <GenerationWatcher editionId={edition.id} generationProgress={generationProgress} />
        )}

        {/* Edition Header + Status */}
        <div className="border-b-4 border-double border-ink pb-6 mb-10">
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div>
              <p
                className={`text-[10px] font-sans font-bold uppercase tracking-widest mb-1 ${
                  edition.status === "published" ? "text-green-700" : "text-amber-600"
                }`}
              >
                {edition.status.toUpperCase()}
              </p>
              <h2 className="font-masthead text-5xl">{edition.title}</h2>
              <p className="text-xs font-sans text-stone-500 mt-1">{edition.vol}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3 no-print">
              <a
                href={`/admin/editions/${edition.id}/preview`}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold uppercase tracking-widest border border-ink hover:bg-stone-100 transition-colors"
              >
                <span className="material-icons text-sm">visibility</span> Preview
              </a>
              {edition.status === EDITION_STATUS_DRAFT ? (
                <form method="POST" action={`/admin/editions/${edition.id}/publish`}>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold uppercase tracking-widest bg-ink text-paper hover:bg-ink-light transition-colors"
                  >
                    <span className="material-icons text-sm">publish</span> Publish
                    Edition
                  </button>
                </form>
              ) : (
                <>
                  <a
                    href={`/edition/${edition.id}`}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold uppercase tracking-widest border border-green-600 text-green-700 hover:bg-green-50 transition-colors"
                  >
                    <span className="material-icons text-sm">open_in_new</span> View
                    Live
                  </a>
                  <a
                    href={`/admin/editions/${edition.id}/distribute`}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold uppercase tracking-widest border border-ink hover:bg-stone-100 transition-colors"
                  >
                    <span className="material-icons text-sm">campaign</span> Distribute
                  </a>
                  <form method="POST" action={`/admin/editions/${edition.id}/newsletter/send`}>
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold uppercase tracking-widest border border-ink hover:bg-stone-100 transition-colors"
                    >
                      <span className="material-icons text-sm">mail</span> Send
                      Newsletter
                    </button>
                  </form>
                  <form method="POST" action={`/admin/editions/${edition.id}/unpublish`}>
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold uppercase tracking-widest border border-stone-300 text-stone-500 hover:border-red-400 hover:text-red-700 transition-colors"
                    >
                      Unpublish
                    </button>
                  </form>
                </>
              )}
              {edition.generationStatus !== "running" && (
                <form
                  method="POST"
                  action={`/admin/editions/${edition.id}/delete`}
                  data-confirm="Permanently delete this edition and all its articles?"
                >
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold uppercase tracking-widest text-red-600 border border-red-200 hover:bg-red-50 transition-colors"
                  >
                    <span className="material-icons text-sm">delete</span> Delete
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
          {/* Left: Edition metadata form */}
          <div className="lg:col-span-1">
            <h3 className="font-headline text-lg font-bold border-b border-ink pb-2 mb-5">
              Edition Metadata
            </h3>
            <form
              method="POST"
              action={`/admin/editions/${edition.id}/update`}
              encType="multipart/form-data"
              className="space-y-5 font-serif"
            >
              <div>
                <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                  Title
                </label>
                <input
                  type="text"
                  name="title"
                  defaultValue={edition.title}
                  required
                  className="w-full bg-transparent border-b-2 border-ink-light focus:border-ink px-1 py-2 text-lg font-headline"
                />
              </div>
              <div>
                <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                  Volume
                </label>
                <input
                  type="text"
                  name="vol"
                  defaultValue={edition.vol}
                  className="w-full bg-transparent border-b-2 border-ink-light focus:border-ink px-1 py-2 text-sm font-sans"
                />
              </div>
              <div>
                <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                  Cover Image URL
                </label>
                <input
                  type="url"
                  name="cover_image_url"
                  defaultValue={edition.coverImage ?? ""}
                  placeholder="https://..."
                  className="w-full bg-transparent border-b-2 border-ink-light focus:border-ink px-1 py-2 text-sm font-sans"
                />
              </div>
              <div>
                <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                  Or Upload Cover
                </label>
                <input
                  type="file"
                  name="cover_image"
                  accept="image/*"
                  className="w-full text-xs font-sans text-stone-600 file:mr-3 file:py-1.5 file:px-3 file:border-0 file:text-xs file:font-bold file:uppercase file:bg-ink file:text-paper hover:file:bg-ink-light"
                />
              </div>
              {coverSrc && (
                <div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={coverSrc}
                    alt="Cover"
                    className="w-full h-32 object-cover border border-stone-300 grayscale"
                  />
                </div>
              )}
              <button
                type="submit"
                className="w-full px-4 py-2.5 bg-ink text-paper text-xs font-bold font-sans uppercase tracking-widest hover:bg-ink-light transition-colors"
              >
                Save Metadata
              </button>
            </form>

            {activityCount > 0 && (
              <div className="mt-8 border-t border-stone-200 pt-5">
                <h4 className="font-sans text-xs font-bold uppercase tracking-widest text-stone-500 mb-3">
                  Fetched Activity ({activityCount} events)
                </h4>
                <ul className="space-y-1.5 max-h-48 overflow-y-auto">
                  {recentActivities.map((act, index) => (
                    <li
                      key={index}
                      className="text-[10px] font-sans text-stone-600 flex items-start gap-1.5"
                    >
                      <span className="font-bold uppercase text-stone-400 shrink-0">
                        {act.eventType}
                      </span>
                      <span className="truncate">{act.title}</span>
                    </li>
                  ))}
                  {activityCount > 15 && (
                    <li className="text-[10px] font-sans text-stone-400 italic">
                      ... and {activityCount - 15} more
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>

          {/* Right: Articles list + add form */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
              <h3 className="font-headline text-lg font-bold border-b border-ink pb-2 flex-1 min-w-0">
                Articles ({articles.length})
              </h3>
              <div className="flex gap-2 shrink-0">
                <a
                  href={`/admin/editions/${edition.id}/articles/generate`}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold font-sans uppercase tracking-widest bg-purple-700 text-white hover:bg-purple-800 transition-colors"
                >
                  <span className="material-icons text-sm">auto_awesome</span> Generate
                </a>
                <a
                  href={`/admin/editions/${edition.id}/articles/rank`}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold font-sans uppercase tracking-widest border border-ink hover:bg-stone-100 transition-colors"
                >
                  <span className="material-icons text-sm">leaderboard</span> Rankings
                </a>
                <button
                  type="button"
                  data-toggle="add-article-section"
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold font-sans uppercase tracking-widest border border-ink hover:bg-stone-100 transition-colors"
                >
                  <span className="material-icons text-sm">add</span> Add Article
                </button>
              </div>
            </div>

            {/* Add article inline form (hidden by default) */}
            <div
              id="add-article-section"
              className="hidden mb-8 border-2 border-dashed border-stone-300 p-6 bg-stone-50"
            >
              <h4 className="font-headline font-bold text-base mb-4">Add New Article</h4>
              <form
                method="POST"
                action={`/admin/editions/${edition.id}/articles/add`}
                encType="multipart/form-data"
                className="space-y-4"
              >
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                      Title *
                    </label>
                    <input
                      type="text"
                      name="title"
                      required
                      className="w-full bg-white border border-stone-300 focus:border-ink px-3 py-2 text-sm font-serif"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                      Category
                    </label>
                    <select
                      name="category"
                      defaultValue="General"
                      className="w-full bg-white border border-stone-300 focus:border-ink px-3 py-2 text-sm font-sans"
                    >
                      {ARTICLE_CATEGORIES.map((cat) => (
                        <option key={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                      Author
                    </label>
                    <input
                      type="text"
                      name="author"
                      defaultValue="Staff Writer"
                      className="w-full bg-white border border-stone-300 focus:border-ink px-3 py-2 text-sm font-sans"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                      Date
                    </label>
                    <input
                      type="date"
                      name="date"
                      defaultValue={defaultArticleDate}
                      className="w-full bg-white border border-stone-300 focus:border-ink px-3 py-2 text-sm font-sans"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                      Video URL
                    </label>
                    <input
                      type="url"
                      name="video_url"
                      placeholder="https://youtube.com/..."
                      className="w-full bg-white border border-stone-300 focus:border-ink px-3 py-2 text-sm font-sans"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                      Image
                    </label>
                    <input
                      type="file"
                      name="image"
                      accept="image/*"
                      className="w-full text-xs font-sans file:mr-2 file:py-1 file:px-2 file:border-0 file:text-xs file:bg-stone-200"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                      Audio
                    </label>
                    <input
                      type="file"
                      name="audio"
                      accept="audio/*"
                      className="w-full text-xs font-sans file:mr-2 file:py-1 file:px-2 file:border-0 file:text-xs file:bg-stone-200"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                      Content * (Markdown)
                    </label>
                    <textarea
                      name="content"
                      rows={6}
                      required
                      className="w-full bg-white border border-stone-300 focus:border-ink px-3 py-2 text-sm font-serif leading-relaxed"
                    />
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    data-toggle="add-article-section"
                    className="px-4 py-2 text-xs font-bold font-sans uppercase tracking-widest border border-stone-300 hover:bg-stone-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 text-xs font-bold font-sans uppercase tracking-widest bg-ink text-paper hover:bg-ink-light"
                  >
                    Save Article
                  </button>
                </div>
              </form>
            </div>

            {/* Articles list — merged with generationProgress.sections (see
                mergeSectionsWithArticles above) so a "writing…" placeholder
                shows in the right spot while its section is still being
                generated, and a "could not generate" note shows for a
                section that failed on its own (self-caught LLM error) or was
                aborted (the rarer case where generation stopped before
                reaching it) — sections settle independently under
                concurrency, so this can appear next to normally-written
                sections rather than only trailing them. */}
            {hasAnythingToShow ? (
              <div className="space-y-3">
                {sectionRows.map((row) => {
                  if (row.articles.length > 0) {
                    return row.articles.map((article) => (
                      <ArticleCard key={article.id} article={article} editionId={edition.id} />
                    ));
                  }
                  if (row.placeholder?.kind === "writing") {
                    return (
                      <div
                        key={row.key}
                        className="border border-dashed border-purple-200 bg-purple-50/50 p-4 flex items-center gap-3"
                      >
                        <span className="material-icons text-purple-500 animate-spin text-lg">
                          autorenew
                        </span>
                        <p className="text-xs font-sans text-purple-700">
                          Writing <span className="font-bold">{row.placeholder.category}</span>…
                        </p>
                      </div>
                    );
                  }
                  if (row.placeholder?.kind === "failed") {
                    return (
                      <div
                        key={row.key}
                        className="border border-dashed border-stone-300 bg-stone-50 p-4"
                      >
                        <p className="text-xs font-sans text-stone-500 italic">
                          Could not generate this section ({row.placeholder.category}).
                        </p>
                      </div>
                    );
                  }
                  return null;
                })}
                {remainingArticles.map((article) => (
                  <ArticleCard key={article.id} article={article} editionId={edition.id} />
                ))}
              </div>
            ) : (
              <div className="text-center py-10 border-2 border-dashed border-stone-200">
                <span className="material-icons text-4xl text-stone-300 block mb-2">article</span>
                <p className="font-serif italic text-stone-500">No articles yet. Add one above.</p>
              </div>
            )}
          </div>
        </div>

        {/* GitHub Insights — the raw stats bank + heuristic topic candidates
            computed by `@/lib/github-stats` and `@/lib/topic-candidates`
            during generation (plan Implementation Step 4). Unmarking a topic
            candidate hides (not deletes) the article it auto-generated;
            marking/unmarking a githubStats metric is a pure annotation. */}
        {(githubStats || (topicCandidates && topicCandidates.length > 0)) && (
          <div className="mt-12 border-t-4 border-double border-ink pt-8">
            <h3 className="font-headline text-lg font-bold border-b border-ink pb-2 mb-5">
              GitHub Insights
            </h3>

            {topicCandidates && topicCandidates.length > 0 && (
              <div className="mb-8">
                <h4 className="font-sans text-xs font-bold uppercase tracking-widest text-stone-500 mb-3">
                  Topic Candidates
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {topicCandidates.map((candidate, index) => {
                    // `id` is only present on candidates computed after this
                    // field was added — an edition whose topicCandidates were
                    // computed by an older version of computeTopicCandidates()
                    // (before this session's change) won't have it. Fall back
                    // to the same `${kind}-${index}` scheme the backend now
                    // uses, so old data doesn't render with a colliding
                    // `undefined` key; marking such a candidate still works
                    // for the session (React key + toggle route both agree on
                    // the derived id), it just can't be linked to an
                    // already-existing article generated before this field
                    // existed — there isn't one, since auto-generation from
                    // topic candidates is new in this same change.
                    const candidateId = candidate.id ?? `${candidate.kind}-${index}`;
                    return (
                      <TopicCandidateCard
                        key={candidateId}
                        candidate={{ ...candidate, id: candidateId }}
                        marked={isTopicCandidateMarked(curatorMarks, candidateId)}
                        editionId={edition.id}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {githubStats && (
              <div>
                <h4 className="font-sans text-xs font-bold uppercase tracking-widest text-stone-500 mb-3">
                  Stats Bank
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6">
                  {GITHUB_STAT_SECTIONS.map(({ section, label, metrics }) => (
                    <div key={section}>
                      <h5 className="text-[10px] font-sans font-bold uppercase tracking-widest text-stone-400 mb-1.5">
                        {label}
                      </h5>
                      <div>
                        {metrics.map((metric) => {
                          const key = `${section}.${metric.key}`;
                          return (
                            <GithubStatRow
                              key={key}
                              label={metric.label}
                              value={getStatValue(githubStats, section, metric.key)}
                              marked={isGithubStatMarked(curatorMarks, key)}
                              editionId={edition.id}
                              statKey={key}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* The `data-confirm` window.confirm() intercept used to live here too,
          but it's now delegated in the shared script in NewspaperShell.tsx
          (see the plan's Implementation Step 5) — keeping both would show two
          confirm() dialogs per delete. The setInterval-based full-page reload
          that used to live here is gone too: GenerationWatcher (above) now
          drives updates via SSE + router.refresh() instead. */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            document.querySelectorAll('[data-toggle]').forEach(function (btn) {
              btn.addEventListener('click', function () {
                var target = document.getElementById(btn.getAttribute('data-toggle'));
                if (target) target.classList.toggle('hidden');
              });
            });
          `,
        }}
      />
    </NewspaperShell>
  );
}
