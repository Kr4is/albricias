/**
 * Per-network social post copy for a published edition — X, Bluesky,
 * Mastodon (auto-postable, each with its own character budget), plus
 * LinkedIn and Instagram (copy-paste only, no hard limit enforced).
 *
 * One LLM call (the `socialCopyAgent` desk, `@/mastra/agents/social`)
 * produces the five bodies; the edition link is appended programmatically
 * afterward rather than trusted to the model, so it's always present and
 * always well-formed. Each auto-postable network's body is defensively
 * truncated to fit its limit *after* reserving room for the link — a
 * mis-sized LLM response can never produce an unpostable text.
 */

import { editionArticles, editionById } from "@/lib/editions";
import { periodLabel } from "@/lib/edition-helpers";
import { runNewspaperAgent } from "@/mastra/agents/base";
import { socialCopyAgent } from "@/mastra/agents/social";
import { BLUESKY_TEXT_LIMIT } from "./bluesky";
import { MASTODON_TEXT_LIMIT } from "./mastodon";
import { TWITTER_TEXT_LIMIT } from "./twitter";

export interface SocialCopyResult {
  x: string;
  bluesky: string;
  mastodon: string;
  linkedin: string;
  instagram: string;
}

/** Generous, non-network-enforced caps for the copy-paste-only networks. */
const LINKEDIN_MAX = 3000;
const INSTAGRAM_MAX = 2200;

function siteUrl(): string {
  return (process.env.SITE_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/** Absolute public URL for an edition, per `web/src/app/edition/[editionId]/page.tsx`. */
export function editionUrl(editionId: number): string {
  return `${siteUrl()}/edition/${editionId}`;
}

/**
 * Trim `body` to fit within `limit` once ` \n\n${link}` is appended, cutting
 * at the last whole word inside the budget rather than mid-word.
 */
function fitWithLink(body: string, link: string, limit: number): string {
  const separator = "\n\n";
  const budget = limit - separator.length - link.length;
  let trimmed = body.trim();
  if (trimmed.length > Math.max(budget, 0)) {
    trimmed = trimmed.slice(0, Math.max(budget, 0));
    const lastSpace = trimmed.lastIndexOf(" ");
    if (lastSpace > 0) trimmed = trimmed.slice(0, lastSpace);
    trimmed = trimmed.trim();
  }
  return `${trimmed}${separator}${link}`;
}

type SectionKey = "X" | "BLUESKY" | "MASTODON" | "LINKEDIN" | "INSTAGRAM";

/** Parses the `### SECTION\n<body>` format the prompt asks the model for. */
function parseSections(raw: string): Record<SectionKey, string> {
  const result: Record<SectionKey, string> = {
    X: "",
    BLUESKY: "",
    MASTODON: "",
    LINKEDIN: "",
    INSTAGRAM: "",
  };
  const pattern = /^###\s*(X|BLUESKY|MASTODON|LINKEDIN|INSTAGRAM)\s*$/gim;
  const matches = [...raw.matchAll(pattern)];
  for (let i = 0; i < matches.length; i += 1) {
    const key = matches[i][1].toUpperCase() as SectionKey;
    const start = (matches[i].index ?? 0) + matches[i][0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? raw.length) : raw.length;
    result[key] = raw.slice(start, end).trim();
  }
  return result;
}

/** Plain-text fallback used when copy generation itself fails (e.g. no `OPENAI_API_KEY`). */
export function defaultSocialCopy(edition: { id: number; title: string }): SocialCopyResult {
  const link = editionUrl(edition.id);
  const line = `${edition.title} is out now.`;
  return {
    x: `${line}\n\n${link}`,
    bluesky: `${line}\n\n${link}`,
    mastodon: `${line}\n\n${link}`,
    linkedin: `A new edition of ¡Albricias! has just been published: "${edition.title}". Read it here:\n\n${link}`,
    instagram: `New edition: ${edition.title} 📰\n\n${link}\n\n#newspaper #newsletter`,
  };
}

/**
 * Generates the five networks' post copy for `editionId` via one LLM call.
 *
 * Throws when `OPENAI_API_KEY` (or `apiKey`) is unset, or the edition doesn't
 * exist — callers (the distribute screen) catch this and fall back to
 * {@link defaultSocialCopy} rather than crash, matching this codebase's
 * graceful-degradation convention for missing credentials.
 */
export async function generateSocialCopy(
  editionId: number,
  apiKey?: string,
): Promise<SocialCopyResult> {
  const key = apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is not set.");

  const edition = await editionById(editionId);
  if (!edition) throw new Error(`Edition ${editionId} not found.`);

  const articles = await editionArticles(editionId);
  const link = editionUrl(editionId);
  const label = periodLabel(edition);

  const articleList = articles
    .slice(0, 12)
    .map((article) => `- [${article.category}] ${article.title}`)
    .join("\n");

  // Character budgets reserve room for the link the caller appends afterward.
  const xBudget = TWITTER_TEXT_LIMIT - link.length - 2;
  const blueskyBudget = BLUESKY_TEXT_LIMIT - link.length - 2;
  const mastodonBudget = MASTODON_TEXT_LIMIT - link.length - 2;

  const prompt =
    `A new edition of ¡Albricias! has just been published: "${edition.title}" (${label}).\n\n` +
    `Its articles:\n${articleList || "(no articles listed)"}\n\n` +
    "Write promotional social copy for five networks. Do not include the edition " +
    "link yourself — it is appended after your text. Respond in exactly this " +
    "format, one section per network, nothing else:\n\n" +
    "### X\n<post text, at most " +
    `${xBudget} characters>\n\n` +
    "### BLUESKY\n<post text, at most " +
    `${blueskyBudget} characters>\n\n` +
    "### MASTODON\n<post text, at most " +
    `${mastodonBudget} characters>\n\n` +
    "### LINKEDIN\n<a longer, more reflective post, a few sentences>\n\n" +
    "### INSTAGRAM\n<a caption-style post with 3-5 relevant hashtags>";

  const raw = await runNewspaperAgent(socialCopyAgent, {
    user: prompt,
    apiKey: key,
    maxTokens: 700,
  });
  const sections = parseSections(raw);

  const fallback = defaultSocialCopy(edition);
  return {
    x: sections.X ? fitWithLink(sections.X, link, TWITTER_TEXT_LIMIT) : fallback.x,
    bluesky: sections.BLUESKY
      ? fitWithLink(sections.BLUESKY, link, BLUESKY_TEXT_LIMIT)
      : fallback.bluesky,
    mastodon: sections.MASTODON
      ? fitWithLink(sections.MASTODON, link, MASTODON_TEXT_LIMIT)
      : fallback.mastodon,
    linkedin: sections.LINKEDIN
      ? fitWithLink(sections.LINKEDIN, link, LINKEDIN_MAX)
      : fallback.linkedin,
    instagram: sections.INSTAGRAM
      ? fitWithLink(sections.INSTAGRAM, link, INSTAGRAM_MAX)
      : fallback.instagram,
  };
}
