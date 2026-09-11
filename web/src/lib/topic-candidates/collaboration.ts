/**
 * Detectors for work that involved other people or a shipped artifact — the
 * kinds with a built-in before/after.
 *
 * Every figure here comes out of `GithubStats.collaboration`, whose PR and
 * issue lifecycle fields are *optional by contract*: absent means "GitHub never
 * told us", not "zero" (see `src/lib/github-stats/types.ts`'s header). So a
 * detector that needs one treats its absence as "this kind doesn't fire",
 * never as a failing comparison against zero — a PAT without the right scope
 * must not be able to manufacture a story.
 *
 * None of these can name the repos behind them: the bank stores PR, issue and
 * release *counts*, not the repos they landed in. They leave `repos` empty
 * rather than borrowing the period's busiest repo, which would read as an
 * assertion nothing in the data supports.
 */

import type { GithubStats } from "@/lib/github-stats";
import { count, nameList } from "./shared";
import type { RawCandidate } from "./types";

/** PRs needed before a fast turnaround is a habit rather than one lucky merge. */
const FAST_PR_MIN_COUNT = 3;

/** Mean open-to-resolved hours at or under which the turnaround is the story. */
const FAST_PR_MAX_LIFETIME_HOURS = 24;

const BUGFIX_MIN_ISSUES_CLOSED = 1;
const BUGFIX_MIN_FIX_COMMITS = 1;
const RELEASE_MIN_COUNT = 1;

/** Several PRs, all resolved quickly — the "how I keep changes small" angle. */
export function detectFastPrVelocity(stats: GithubStats): RawCandidate | null {
  const { prsOpened, avgPrLifetimeHours, prsMerged } = stats.collaboration;
  if (prsOpened < FAST_PR_MIN_COUNT) return null;
  if (avgPrLifetimeHours === undefined || avgPrLifetimeHours > FAST_PR_MAX_LIFETIME_HOURS) {
    return null;
  }

  return {
    kind: "fastPrVelocity",
    title: "Pull requests that don't sit around",
    repos: [],
    bullets: [
      `${count(prsOpened, "pull request")} opened this period`,
      `${avgPrLifetimeHours} hours from open to merge or close, on average`,
      prsMerged === undefined ? null : `${prsMerged} of them merged`,
    ].filter((bullet): bullet is string => bullet !== null),
    supporting: prsOpened,
  };
}

/**
 * Issues closed *and* fix commits written — the "how I fixed X" angle.
 *
 * The two counts are correlated only by period, not matched issue-to-commit:
 * nothing in the stored rows links a `fix:` commit to the issue it closed, and
 * inferring the link from timestamps would be a guess dressed as provenance.
 * The candidate is therefore a prompt to go find the story, and its bullets say
 * exactly what was counted so the writer isn't misled about what's established.
 */
export function detectBugfixStory(stats: GithubStats): RawCandidate | null {
  const issuesClosed = stats.collaboration.issuesClosed;
  const fixCommits =
    stats.content.conventionalCommitBreakdown.find((entry) => entry.keyword === "fix")?.count ?? 0;
  if (issuesClosed === undefined || issuesClosed < BUGFIX_MIN_ISSUES_CLOSED) return null;
  if (fixCommits < BUGFIX_MIN_FIX_COMMITS) return null;

  return {
    kind: "bugfixStory",
    title: "Something broke, and then it didn't",
    repos: [],
    bullets: [
      `${count(issuesClosed, "issue")} closed this period`,
      `${count(fixCommits, "commit")} prefixed \`fix\``,
      "the two are counted over the same period, not matched to each other",
    ],
    supporting: issuesClosed + fixCommits,
  };
}

/** Anything shipped — the one kind that comes with its own deadline and changelog. */
export function detectRelease(stats: GithubStats): RawCandidate | null {
  // `collaboration.releasesPublished` and `volume.totalReleases` count the same
  // rows from different directions; taking the larger keeps the candidate alive
  // if one group was written by a version that counted them differently.
  const releases = Math.max(stats.collaboration.releasesPublished, stats.volume.totalReleases);
  if (releases < RELEASE_MIN_COUNT) return null;

  const top = stats.volume.mostActiveRepo;

  return {
    kind: "release",
    title: releases === 1 ? "A release went out" : `${count(releases, "release")} went out`,
    repos: [],
    bullets: [
      `${count(releases, "release")} published this period`,
      top ? `the period's busiest repo was ${top.repo} — check whether it's the one that shipped` : null,
    ].filter((bullet): bullet is string => bullet !== null),
    supporting: releases,
  };
}

/** Work in someone else's repo — rarer than own-repo work, and a different story. */
export function detectExternalContribution(stats: GithubStats): RawCandidate | null {
  const repos = stats.collaboration.externalRepos;
  if (repos.length === 0) return null;

  return {
    kind: "externalContribution",
    title:
      repos.length === 1
        ? `Contributing to ${repos[0]}`
        : `Contributing to ${count(repos.length, "repository", "repositories")} that aren't mine`,
    repos: [...repos],
    bullets: [
      `${count(repos.length, "external repository", "external repositories")} touched: ${nameList(repos)}`,
      "the owner differs from the configured GitHub account, so these are someone else's projects",
    ],
    supporting: repos.length,
  };
}
