/**
 * Runnable self-check for finding a repository's own pictures and for the
 * image proxy's signatures. `npx tsx scripts/check-images.ts`.
 */
import assert from "node:assert/strict";
import { pageImage, readmeImages } from "../src/lib/sources/readme-images";
import { proxiedImageUrl, verifyImageUrl } from "../src/lib/image-proxy";
import { safeFetch } from "../src/lib/sources/safe-fetch";

const BASE = "https://raw.githubusercontent.com/me/app/main/README.md";

// umami's README head: a logo, then a row of badges and social buttons.
{
  const readme = `<p align="center"><img src="https://content.umami.is/website/images/umami-logo.png" alt="Umami Logo" width="400"></p>
<h1 align="center">Umami</h1>
<p align="center">
  <a href="x"><img src="https://img.shields.io/github/release/umami-software/umami.svg" alt="GitHub Release" /></a>
  <a href="x"><img src="https://img.shields.io/badge/Try%20Demo%20Now-Click%20Here-brightgreen" height="20" alt="Demo"></a>
  <a href="x"><img src="https://img.shields.io/badge/Discord--blue?style=social&logo=discord" alt="Discord"></a>
</p>`;
  const images = readmeImages(readme, "umami-software/umami", BASE);
  assert.deepEqual(images.map((i) => i.url), ["https://content.umami.is/website/images/umami-logo.png"]);
  assert.equal(images[0].fit, "contain");
  assert.equal(images[0].caption, "Umami Logo");
}

// restic's: badges and a sponsor's logo — nothing of restic itself.
{
  const readme = `![Documentation](https://readthedocs.org/projects/restic/badge/?version=latest)
![Build Status](https://github.com/restic/restic/workflows/test/badge.svg)
![Go Report Card](https://goreportcard.com/badge/github.com/restic/restic)
Sponsorship: [![Sponsored by AppsCode](https://cdn.appscode.com/images/logo/appscode/ac-logo-color.png)](https://appscode.com)`;
  assert.deepEqual(readmeImages(readme, "restic/restic", BASE), []);
}

// The header banner, then diagrams and screenshots; relative and blob paths resolved, tiny icons and SVGs dropped, captions only when they say something.
{
  const readme = `# App
<img src="docs/icon.png" width="32">
![app](assets/banner.png)
![Architecture: how the agents talk to the runtime](https://github.com/me/app/blob/main/docs/arch.png?raw=true)
![](https://example.com/diagram.svg)
<img src="./shots/screenshot-dark.jpg" alt="screenshot">`;
  const images = readmeImages(readme, "me/app", BASE);
  assert.deepEqual(images.map((i) => i.url), [
    "https://raw.githubusercontent.com/me/app/main/assets/banner.png",
    "https://raw.githubusercontent.com/me/app/main/docs/arch.png",
    "https://raw.githubusercontent.com/me/app/main/shots/screenshot-dark.jpg",
  ]);
  assert.equal(images[0].caption, null);
  assert.equal(images[1].caption, "Architecture: how the agents talk to the runtime");
  assert.equal(images[2].caption, null);
}

// A homepage's preview image, relative to the page.
{
  assert.equal(pageImage(`<head><meta property="og:image" content="/og/cover.png"></head>`, "https://example.org/docs/"), "https://example.org/og/cover.png");
  assert.equal(pageImage(`<meta content="https://cdn.example.org/card.jpg" name="twitter:image">`, "https://example.org/"), "https://cdn.example.org/card.jpg");
  assert.equal(pageImage(`<meta property="og:title" content="x">`, "https://example.org/"), null);
}

// The proxy only serves what this server signed.
{
  const url = proxiedImageUrl("https://example.org/a.png");
  const params = new URL(url, "http://localhost").searchParams;
  assert.equal(params.get("u"), "https://example.org/a.png");
  assert.ok(verifyImageUrl(params.get("u")!, params.get("s")!));
  assert.ok(!verifyImageUrl("https://example.org/b.png", params.get("s")!));
  assert.ok(!verifyImageUrl(params.get("u")!, "forged"));
}

// Never the local network, never plain http, never another port.
(async () => {
  for (const target of ["https://127.0.0.1/x.png", "https://localhost/x.png", "http://example.org/x.png", "https://example.org:8443/x.png", "https://[::1]/x.png", "https://169.254.169.254/latest/meta-data", "https://10.0.0.5/x.png"]) {
    await assert.rejects(safeFetch(target, { maxBytes: 1024, timeoutMs: 2000 }), Error, target);
  }
  console.log("images self-check: OK");
})();
