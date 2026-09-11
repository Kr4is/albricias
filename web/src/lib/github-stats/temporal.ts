/**
 * Temporal metrics — *when* the period's work happened.
 *
 * Every figure here is UTC, matching the `YYYY-MM-DD` convention
 * `@/lib/rankings/activity` already stores and narrates. Using the admin's
 * local timezone would read better ("you commit at 2am") but would silently
 * disagree with the activity ranking article computed from the same rows, and
 * this bank is meant to be cross-checkable against it (see the plan's
 * verification steps).
 *
 * Pure function, no I/O, never throws: rows with a `null` timestamp are simply
 * not clock readings and are skipped rather than treated as epoch zero.
 */

import { dayKey, isContributionEvent, MS_PER_DAY, topEntry } from "./shared";
import type { GithubStatsRow, TemporalStats, TimeOfDaySplit } from "./types";

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/**
 * Hour-of-day boundaries for the four-way split, chosen to match how the
 * phrases are ordinarily used rather than to divide the day evenly — "late
 * night" is the small hours (00:00-04:59), not a quarter of the clock.
 */
const TIME_OF_DAY_BUCKETS: ReadonlyArray<{ key: keyof TimeOfDaySplit; until: number }> = [
  { key: "lateNight", until: 5 },
  { key: "morning", until: 12 },
  { key: "afternoon", until: 18 },
  { key: "evening", until: 24 },
];

function bucketFor(hour: number): keyof TimeOfDaySplit {
  return (TIME_OF_DAY_BUCKETS.find((b) => hour < b.until) ?? TIME_OF_DAY_BUCKETS[3]).key;
}

/**
 * Busiest day, most productive hour, preferred weekday, time-of-day split,
 * longest streak and gap, and the period's first/last contribution instants.
 *
 * Only `CONTRIBUTION_EVENT_TYPES` rows are considered, so starring a
 * repo at 3am neither starts a streak nor crowns a "most productive hour".
 * The one exception is {@link TemporalStats.mostProductiveHour}, computed from
 * commits alone: a PR or a release is the *end* of a stretch of work, while a
 * commit is the closest thing GitHub gives us to a timestamped keystroke.
 */
export function computeTemporalStats(rows: GithubStatsRow[]): TemporalStats {
  const dayCounts = new Map<string, number>();
  const commitHourCounts = new Map<number, number>();
  const weekdayCounts = new Map<string, number>();
  const timeOfDaySplit: TimeOfDaySplit = { morning: 0, afternoon: 0, evening: 0, lateNight: 0 };
  let firstEventAt: Date | null = null;
  let lastEventAt: Date | null = null;

  for (const row of rows) {
    if (!row.timestamp || !isContributionEvent(row)) continue;
    const at = row.timestamp;

    dayCounts.set(dayKey(at), (dayCounts.get(dayKey(at)) ?? 0) + 1);

    const weekday = WEEKDAY_NAMES[at.getUTCDay()];
    weekdayCounts.set(weekday, (weekdayCounts.get(weekday) ?? 0) + 1);

    const hour = at.getUTCHours();
    timeOfDaySplit[bucketFor(hour)] += 1;
    if (row.eventType === "commit") {
      commitHourCounts.set(hour, (commitHourCounts.get(hour) ?? 0) + 1);
    }

    if (!firstEventAt || at < firstEventAt) firstEventAt = at;
    if (!lastEventAt || at > lastEventAt) lastEventAt = at;
  }

  const busiest = topEntry(dayCounts);
  const productiveHour = topEntry(commitHourCounts);
  const weekday = topEntry(weekdayCounts);
  const { longestStreakDays, longestGapDays } = measureRuns([...dayCounts.keys()]);

  return {
    busiestDay: busiest ? { date: busiest[0], count: busiest[1] } : null,
    mostProductiveHour: productiveHour ? { hour: productiveHour[0], count: productiveHour[1] } : null,
    preferredWeekday: weekday ? { weekday: weekday[0], count: weekday[1] } : null,
    timeOfDaySplit,
    longestStreakDays,
    longestGapDays,
    firstEventAt: firstEventAt ? firstEventAt.toISOString() : null,
    lastEventAt: lastEventAt ? lastEventAt.toISOString() : null,
  };
}

/**
 * Longest run of consecutive active days, and the longest run of silent days
 * *between* two active days.
 *
 * The gap is measured between activity rather than against the period's
 * boundaries on purpose: a period generated mid-month would otherwise report a
 * huge "gap" for the days that simply haven't happened yet.
 */
function measureRuns(activeDayKeys: string[]): { longestStreakDays: number; longestGapDays: number } {
  const days = activeDayKeys
    .map((key) => Date.parse(`${key}T00:00:00Z`))
    .filter((ms) => !Number.isNaN(ms))
    .sort((a, b) => a - b);
  if (days.length === 0) return { longestStreakDays: 0, longestGapDays: 0 };

  let longestStreakDays = 1;
  let longestGapDays = 0;
  let currentStreak = 1;

  for (let i = 1; i < days.length; i += 1) {
    const daysApart = Math.round((days[i] - days[i - 1]) / MS_PER_DAY);
    if (daysApart === 1) {
      currentStreak += 1;
      longestStreakDays = Math.max(longestStreakDays, currentStreak);
    } else {
      currentStreak = 1;
      longestGapDays = Math.max(longestGapDays, daysApart - 1);
    }
  }

  return { longestStreakDays, longestGapDays };
}
