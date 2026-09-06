/**
 * "Generate edition" — ported from `admin.edition_generate`
 * (`app/routes/admin.py:99-235`), generalised from a fixed month/year to the
 * active cadence's period, and extended with the blog RSS source (Phase 2).
 *
 * Each source fetch keeps the original's per-source try/catch + non-fatal
 * warning pattern (`admin.py:154-155,200-201`): one source failing must not
 * block the others or block the edition being created. Spotify is only
 * attempted when a `ServiceToken` already exists, refreshing it first if
 * expired — mirroring `admin.py:163-181`.
 */

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { EDITION_STATUS_DRAFT, periodLabel } from "@/lib/edition-helpers";
import { defaultEditionTitle, defaultEditionVol, getCadence, resolvePeriodFromForm } from "@/lib/cadence";
import { getServiceToken, isServiceTokenExpired, upsertServiceToken } from "@/lib/service-token";
import {
  type ActivityItem,
  fetchBlogActivity,
  fetchGithubActivity,
  fetchSpotifyActivity,
  refreshAccessToken,
} from "@/lib/sources";
import { generateEditionDraft } from "@/lib/generation";
import { describeError, flashRedirect, type FlashMessage } from "@/lib/flash";

async function saveActivities(editionId: number, items: ActivityItem[]): Promise<void> {
  if (items.length === 0) return;
  await prisma.serviceActivity.createMany({
    data: items.map((item) => ({
      editionId,
      source: item.source,
      eventType: item.eventType,
      repo: item.repo,
      title: item.title,
      url: item.url,
      timestamp: item.timestamp,
      rawJson: JSON.stringify(item.raw ?? {}),
    })),
  });
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const cadence = await getCadence();

  let period;
  try {
    period = resolvePeriodFromForm(form, cadence);
  } catch (error) {
    return flashRedirect(request, "/admin/editions", [
      { type: "error", text: describeError(error) },
    ]);
  }

  const existing = await prisma.edition.findUnique({
    where: { cadence_periodStart: { cadence, periodStart: period.periodStart } },
  });
  if (existing) {
    return flashRedirect(request, `/admin/editions/${existing.id}/edit`, [
      { type: "info", text: `An edition for ${periodLabel({ cadence, ...period })} already exists.` },
    ]);
  }

  const shape = { cadence, ...period };
  const edition = await prisma.edition.create({
    data: {
      cadence,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      title: defaultEditionTitle(shape),
      vol: defaultEditionVol(shape),
      status: EDITION_STATUS_DRAFT,
    },
  });

  const messages: FlashMessage[] = [];
  let fetchedCount = 0;
  let spotifyFetched = 0;

  // --- GitHub fetch ---
  const githubToken = process.env.GITHUB_TOKEN;
  const githubUsername = process.env.GITHUB_USERNAME;
  if (githubToken && githubUsername) {
    try {
      const activities = await fetchGithubActivity({
        username: githubUsername,
        token: githubToken,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
      });
      await saveActivities(edition.id, activities);
      fetchedCount += activities.length;
    } catch (error) {
      messages.push({ type: "warning", text: `GitHub fetch warning: ${describeError(error)}` });
    }
  } else {
    messages.push({
      type: "warning",
      text: "GITHUB_TOKEN or GITHUB_USERNAME not configured — skipping GitHub fetch.",
    });
  }

  // --- Blog RSS fetch ---
  const blogUrl = process.env.BLOG_RSS_URL;
  if (blogUrl) {
    try {
      const activities = await fetchBlogActivity({
        feedUrl: blogUrl,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
      });
      await saveActivities(edition.id, activities);
      fetchedCount += activities.length;
    } catch (error) {
      messages.push({ type: "warning", text: `Blog fetch warning: ${describeError(error)}` });
    }
  } else {
    messages.push({ type: "warning", text: "BLOG_RSS_URL not configured — skipping blog fetch." });
  }

  // --- Spotify fetch ---
  let spotifyToken = await getServiceToken("spotify");
  if (spotifyToken) {
    try {
      if (isServiceTokenExpired(spotifyToken) && spotifyToken.refreshToken) {
        const refreshed = await refreshAccessToken(spotifyToken.refreshToken);
        await upsertServiceToken({
          service: "spotify",
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token,
          expiresIn: refreshed.expires_in,
        });
        spotifyToken = await getServiceToken("spotify");
      }
      const items = await fetchSpotifyActivity({ accessToken: spotifyToken!.accessToken });
      await saveActivities(edition.id, items);
      spotifyFetched = items.length;
      fetchedCount += spotifyFetched;
    } catch (error) {
      messages.push({ type: "warning", text: `Spotify fetch warning: ${describeError(error)}` });
    }
  } else {
    messages.push({
      type: "info",
      text: "Spotify not connected — visit /admin/spotify/connect to link your account.",
    });
  }

  // --- AI generation ---
  let generatedCount = 0;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey && fetchedCount > 0) {
    try {
      const articles = await generateEditionDraft(edition.id);
      generatedCount = articles.length;
    } catch (error) {
      messages.push({ type: "warning", text: `AI writer warning: ${describeError(error)}` });
    }
  } else if (fetchedCount === 0) {
    messages.push({ type: "info", text: "No activity fetched from any service — AI generation skipped." });
  } else {
    messages.push({ type: "warning", text: "OPENAI_API_KEY not configured — AI generation skipped." });
  }

  messages.push({
    type: "success",
    text:
      `Draft edition '${edition.title}' created with ${fetchedCount - spotifyFetched} GitHub/blog events, ` +
      `${spotifyFetched} Spotify items, and ${generatedCount} AI-generated articles.`,
  });

  return flashRedirect(request, `/admin/editions/${edition.id}/edit`, messages);
}
