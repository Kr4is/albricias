/**
 * Shared types for the GitHub stats bank (`src/lib/github-stats/`).
 *
 * Kept in one file so every metric-group module can describe its own slice of
 * the stored `Edition.githubStats` JSON without importing sideways from a
 * sibling group — the groups are deliberately independent of each other, only
 * `./index.ts` knows about all of them at once.
 *
 * Several fields are declared optional rather than nullable. That is the
 * module's contract for "GitHub didn't give us what this metric needs":
 * a consumer reading the stored JSON can tell "computed, and the answer is
 * zero" (`prsMerged: 0`) apart from "never computed, don't render it"
 * (`prsMerged` absent) — which matters because the PR/issue lifecycle fields
 * come out of `ServiceActivity.rawJson` and are only as trustworthy as what
 * the Search API happened to return for those rows.
 */

/**
 * Reduced view of a `ServiceActivity` row this module needs — mirrors
 * `ActivityRankingRow` in `@/lib/rankings/activity`, plus the two columns the
 * ranking never looks at (`title` for the content metrics, `rawJson` for the
 * PR/issue lifecycle metrics).
 */
export interface GithubStatsRow {
  eventType: string;
  repo: string | null;
  title: string;
  timestamp: Date | null;
  rawJson: string | null;
}

export interface DayCount {
  /** `YYYY-MM-DD`, UTC — the convention `@/lib/rankings/activity` established. */
  date: string;
  count: number;
}

export interface HourCount {
  /** 0-23, UTC. */
  hour: number;
  count: number;
}

export interface WeekdayCount {
  /** "Sunday" .. "Saturday". */
  weekday: string;
  count: number;
}

export interface RepoCount {
  /** `owner/name`. */
  repo: string;
  count: number;
}

export interface KeywordCount {
  /** Conventional-commit type: "feat", "fix", "refactor", … */
  keyword: string;
  count: number;
}

/** Events per coarse part of the day — see `TIME_OF_DAY_BUCKETS` in `./temporal`. */
export interface TimeOfDaySplit {
  morning: number;
  afternoon: number;
  evening: number;
  lateNight: number;
}

export interface TemporalStats {
  busiestDay: DayCount | null;
  mostProductiveHour: HourCount | null;
  preferredWeekday: WeekdayCount | null;
  timeOfDaySplit: TimeOfDaySplit;
  /** Longest run of calendar days each carrying at least one contribution. */
  longestStreakDays: number;
  /** Longest run of consecutive *silent* days between two contribution days. */
  longestGapDays: number;
  /** ISO-8601 UTC instant of the period's earliest contribution. */
  firstEventAt: string | null;
  /** ISO-8601 UTC instant of the period's latest contribution. */
  lastEventAt: string | null;
}

export interface VolumeStats {
  totalCommits: number;
  totalPrs: number;
  totalIssues: number;
  totalReleases: number;
  /** Distinct `owner/name` repos touched by any event type this period. */
  distinctRepos: number;
  mostActiveRepo: RepoCount | null;
  /** `owner/name` of every repo created this period. */
  newRepos: string[];
  /** `owner/name` of every repo starred this period. */
  starredRepos: string[];
}

export interface CollaborationStats {
  /** Repos touched whose owner segment isn't the configured GitHub user. */
  externalRepos: string[];
  prsOpened: number;
  prsMerged?: number;
  prsClosedUnmerged?: number;
  /** Mean hours from a PR's creation to its merge or close, merged/closed PRs only. */
  avgPrLifetimeHours?: number;
  issuesOpened: number;
  issuesClosed?: number;
  reviewsGiven: number;
  releasesPublished: number;
}

export interface EmojiCount {
  emoji: string;
  count: number;
}

export interface ContentStats {
  /** Mean character length of this period's commit subject lines. */
  avgCommitMessageLength: number;
  /** Busiest-first, conventional-commit types only (unprefixed messages are not counted). */
  conventionalCommitBreakdown: KeywordCount[];
  shortestCommitMessage: string | null;
  longestCommitMessage: string | null;
  /** The subject line with the rarest vocabulary this period — see `./content`. */
  mostUnusualCommitMessage: string | null;
  mostUsedEmoji: EmojiCount | null;
}

export interface LanguageBytes {
  language: string;
  bytes: number;
}

export interface LanguageStats {
  /** Busiest-first, top 8 — exactly what `aggregateLanguages` returns. */
  topLanguagesByBytes: LanguageBytes[];
}

/** One period's contribution volume, the only quantity the trend group compares. */
export interface PeriodSummary {
  /** ISO-8601 UTC instant of the period's inclusive start. */
  periodStart: string;
  /** Commits + PRs + issues + releases — see `summarisePeriod` in `./trend`. */
  totalContributions: number;
}

export interface TrendComparison {
  direction: "up" | "down" | "flat";
  previousPeriodStart: string;
  previousTotalContributions: number;
  deltaContributions: number;
  /** `null` when the previous period had zero contributions, so there is no ratio to state. */
  deltaPercent: number | null;
}

export interface BestPeriod extends PeriodSummary {
  isCurrentPeriod: boolean;
}

export interface TrendStats {
  vsPreviousPeriod: TrendComparison | null;
  bestPeriodThisYear: BestPeriod | null;
  /** Current period plus every immediately-preceding period that also had contributions. */
  consecutiveActivePeriods: number;
}

/** The full stored shape — see `Edition.githubStats`'s doc comment in `prisma/schema.prisma`. */
export interface GithubStats {
  temporal: TemporalStats;
  volume: VolumeStats;
  collaboration: CollaborationStats;
  content: ContentStats;
  language: LanguageStats;
  /** `null` for the first edition ever generated — there is nothing to compare against. */
  trend: TrendStats | null;
}
