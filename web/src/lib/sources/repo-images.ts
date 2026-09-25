/**
 * Real pictures of a repository — what its own authors chose to show — for
 * the sections about it. Never GitHub's generated card (the repo name on a
 * grey plate says nothing); in order of preference:
 *
 *   1. its custom social preview, when the owners uploaded one (GraphQL
 *      `usesCustomOpenGraphImage` / `openGraphImageUrl`, one query for all);
 *   2. the pictures in its README — screenshots, banners, diagrams, logos —
 *      with badges, avatars, sponsor walls and SVGs left out, the ones whose
 *      alt text or file name says screenshot/demo/architecture first; their
 *      alt text becomes the caption when it describes something;
 *   3. the `og:image` of its homepage, when it has one and nothing above.
 *
 * Each lookup is best-effort: a repository with nothing to show simply has
 * no picture, and the page runs text in its place. The page loads every
 * picture through the image proxy (`@/lib/image-proxy`).
 */

import { Octokit } from "octokit";

import { MAX_IMAGES_PER_REPO, pageImage, readmeImages, type RepoImage } from "@/lib/sources/readme-images";
import { safeFetch } from "@/lib/sources/safe-fetch";

export type { RepoImage };

/** READMEs (and homepages) looked up at once. */
const LOOKUP_CONCURRENCY = 6;
const MAX_HOMEPAGE_BYTES = 512 * 1024;

/** Runs `task` over `items`, `limit` at a time. */
async function inBatches<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await task(items[next++]);
    }),
  );
}

/** Custom social previews, one GraphQL query for every repository. */
async function socialImages(octokit: Octokit, repos: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (repos.length === 0) return found;
  const fields = repos
    .map((repo, i) => {
      const [owner, name] = repo.split("/");
      return `r${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { usesCustomOpenGraphImage openGraphImageUrl }`;
    })
    .join("\n");
  try {
    const data = await octokit.graphql<Record<string, { usesCustomOpenGraphImage: boolean; openGraphImageUrl: string } | null>>(`query { ${fields} }`);
    repos.forEach((repo, i) => {
      const entry = data[`r${i}`];
      if (entry?.usesCustomOpenGraphImage && entry.openGraphImageUrl) found.set(repo, entry.openGraphImageUrl);
    });
  } catch (error) {
    // A partial answer (one repo renamed or gone) still carries the others.
    const partial = (error as { data?: Record<string, { usesCustomOpenGraphImage: boolean; openGraphImageUrl: string } | null> }).data;
    if (partial) {
      repos.forEach((repo, i) => {
        const entry = partial[`r${i}`];
        if (entry?.usesCustomOpenGraphImage && entry.openGraphImageUrl) found.set(repo, entry.openGraphImageUrl);
      });
    } else {
      console.warn(`[images] social previews unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return found;
}

/**
 * The pictures for each of `repos` (see the header), keyed by `owner/name`
 * as given. `homepages` names each repo's website, when it has one.
 */
export async function fetchRepoImages(repos: string[], homepages: Map<string, string | null>, token: string): Promise<Map<string, RepoImage[]>> {
  const octokit = new Octokit({ auth: token });
  const social = await socialImages(octokit, repos);
  const images = new Map<string, RepoImage[]>();

  await inBatches(repos, LOOKUP_CONCURRENCY, async (repo) => {
    const found: RepoImage[] = [];
    const preview = social.get(repo);
    if (preview) found.push({ url: preview, alt: repo, caption: null, fit: "cover", source: "social" });

    const [owner, name] = repo.split("/");
    try {
      const { data } = await octokit.request("GET /repos/{owner}/{repo}/readme", { owner, repo: name });
      const readme = Buffer.from(data.content, (data.encoding as BufferEncoding) || "base64").toString("utf8");
      const base = data.download_url ?? `https://raw.githubusercontent.com/${repo}/HEAD/${data.path}`;
      found.push(...readmeImages(readme, repo, base));
    } catch {
      // No README, or not readable: the other sources still count.
    }

    const homepage = homepages.get(repo);
    if (found.length === 0 && homepage && !/^https:\/\/(www\.)?github\.com\//i.test(homepage)) {
      try {
        const page = await safeFetch(homepage, { maxBytes: MAX_HOMEPAGE_BYTES, timeoutMs: 5_000, accept: "text/html" });
        const url = page.contentType.includes("html") ? pageImage(new TextDecoder().decode(page.body), page.url) : null;
        if (url) found.push({ url, alt: repo, caption: null, fit: "cover", source: "homepage" });
      } catch {
        // Unreachable site: no picture from it.
      }
    }
    if (found.length > 0) images.set(repo, found.slice(0, MAX_IMAGES_PER_REPO));
  });
  return images;
}
