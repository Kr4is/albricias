/**
 * Reading pictures out of a README or a web page — pure, no network (the
 * lookups are in `./repo-images`). Keeps what shows the project —
 * screenshots, banners, diagrams, its logo — and drops what doesn't:
 * badges, avatars, sponsor walls, counters, and SVGs (the image proxy
 * won't serve them).
 */

import type { ArticleImageRef } from "@/lib/article-blocks";

/** A picture found for a repository, before it's proxied. */
export interface RepoImage {
  url: string;
  alt: string;
  caption: string | null;
  fit: ArticleImageRef["fit"];
  source: "social" | "readme" | "homepage";
}

/** Pictures kept per repository. */
export const MAX_IMAGES_PER_REPO = 3;

/** Hosts that only ever serve badges, avatars, counters and sponsor walls. */
const NOISE_HOSTS = [
  "img.shields.io", "shields.io", "badgen.net", "badge.fury.io", "travis-ci.org", "travis-ci.com", "circleci.com", "codecov.io",
  "coveralls.io", "goreportcard.com", "app.codacy.com", "api.codacy.com", "snyk.io", "deepwiki.com", "avatars.githubusercontent.com",
  "contrib.rocks", "opencollective.com", "img.buymeacoffee.com", "cdn.buymeacoffee.com", "ko-fi.com", "storage.ko-fi.com",
  "api.producthunt.com", "trendshift.io", "awesome.re", "api.star-history.com", "star-history.com", "starchart.cc",
  "github-readme-stats.vercel.app", "visitor-badge.laobi.icu", "komarev.com", "hits.seeyoufarm.com", "pepy.tech",
  "static.pepy.tech", "img.youtube.com", "discordapp.com", "dcbadge.vercel.app", "repobeats.axiom.co", "www.bestpractices.dev",
  "api.securityscorecards.dev", "sonarcloud.io", "flat.badgen.net", "ghcr-badge.egpl.dev", "readthedocs.org", "gitter.im",
];
const NOISE_PATH = /badge|shield|\/workflows\/|actions\/workflow|\/status\.|sponsor|backers|contributors|avatar|\.svg($|\?)/i;
/** Alt text of someone else's picture: a sponsor's logo, a badge, a button. */
const NOISE_ALT = /sponsor|backer|supported by|powered by|built with|badge|build status|coverage|license|downloads|version|discord|twitter|follow|star history|stargazers|contributors|donate|buy me/i;
const SHOWS_THE_PROJECT = /screen ?shot|screen|demo|preview|hero|banner|cover|showcase|overview|architecture|diagram|workflow|example|interface|dashboard|\bui\b/i;
const LOGO = /logo|icon|\bmark\b|emblem/i;

/** Alt text that says nothing: empty, the repo's own name, or a generic word. */
function describes(alt: string, repo: string): boolean {
  const text = alt.trim().toLowerCase();
  const name = repo.split("/")[1].toLowerCase();
  if (text.length < 4 || text === name || text.replace(/[\s_-]+/g, "") === name.replace(/[\s_-]+/g, "")) return false;
  return !/^(image|img|screenshot|logo|banner|picture|photo|preview|demo|header|icon)s?\d*$/.test(text);
}

/** A README reference to the file itself, where the README sits: `github.com/…/blob/…` and `…/raw/…` become raw URLs. */
function normalize(src: string, base: string): string | null {
  try {
    const url = new URL(src.trim(), base);
    if (url.protocol !== "https:") return null;
    const blob = url.hostname === "github.com" && url.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/);
    if (blob) return `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}`;
    return url.toString();
  } catch {
    return null;
  }
}

/** Attribute `name` of an HTML tag's source, if present. */
function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

/**
 * The pictures in a README worth showing, best first. `base` is the URL
 * the README itself was served from, for relative paths. Pure — exported
 * for the self-check.
 */
export function readmeImages(readme: string, repo: string, base: string): RepoImage[] {
  const found: { src: string; alt: string; width: number | null; order: number }[] = [];
  // Markdown `![alt](src "title")`, and `<img …>` tags (inside `<picture>` too).
  for (const match of readme.matchAll(/!\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g)) {
    found.push({ src: match[2], alt: match[1], width: null, order: match.index ?? 0 });
  }
  for (const match of readme.matchAll(/<img\b[^>]*>/gi)) {
    const src = attr(match[0], "src");
    if (!src) continue;
    const width = Number.parseInt(attr(match[0], "width") ?? attr(match[0], "height") ?? "", 10);
    found.push({ src, alt: attr(match[0], "alt") ?? "", width: Number.isFinite(width) ? width : null, order: match.index ?? 0 });
  }
  found.sort((a, b) => a.order - b.order);

  const seen = new Set<string>();
  const images: { image: RepoImage; score: number }[] = [];
  found.forEach((image) => {
    const url = normalize(image.src, base);
    if (!url || seen.has(url)) return;
    seen.add(url);
    const { hostname, pathname, search } = new URL(url);
    if (NOISE_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))) return;
    if (NOISE_PATH.test(pathname + search) || NOISE_ALT.test(image.alt)) return;
    if (image.width !== null && image.width < 120) return;
    const words = `${image.alt} ${pathname.split("/").pop() ?? ""}`;
    const logo = LOGO.test(words);
    // The README's first real picture is usually its header.
    const score = (SHOWS_THE_PROJECT.test(words) ? 3 : 0) + (logo ? -1 : 0) + (images.length === 0 ? 1 : 0);
    images.push({
      image: { url, alt: image.alt.trim() || repo, caption: describes(image.alt, repo) ? image.alt.trim() : null, fit: logo ? "contain" : "cover", source: "readme" },
      score,
    });
  });
  return images
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_IMAGES_PER_REPO)
    .map(({ image }) => image);
}

/** A page's `og:image` (or `twitter:image`), resolved against its URL. Pure — exported for the self-check. */
export function pageImage(html: string, pageUrl: string): string | null {
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (attr(tag[0], "property") ?? attr(tag[0], "name") ?? "").toLowerCase();
    if (key !== "og:image" && key !== "og:image:url" && key !== "twitter:image") continue;
    const content = attr(tag[0], "content");
    const url = content ? normalize(content, pageUrl) : null;
    if (url && !NOISE_PATH.test(new URL(url).pathname)) return url;
  }
  return null;
}

