/**
 * Runs the real PNG export (the Download button) on a `/dev/layouts`
 * fixture in headless Chromium and saves the image, next to a plain
 * screenshot of the live page to compare it with — for debugging what the
 * export gets wrong. Needs `npm run dev`.
 *   [BROWSER=firefox] npx tsx scripts/export-fixture.ts <layout> <articles> <out.png>
 */
import { chromium, firefox } from "playwright-core";

async function main() {
  const [layout = "1", n = "5", out = "export.png"] = process.argv.slice(2);
  const browser = await (process.env.BROWSER === "firefox" ? firefox : chromium).launch({ executablePath: process.env.CHROMIUM_PATH });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const tab = await context.newPage();
  tab.on("console", (message) => {
    if (message.type() === "error") console.log("console error:", message.text().slice(0, 200));
  });
  await tab.goto(`${process.env.BASE_URL ?? "http://localhost:3000"}/dev/layouts?layout=${layout}&n=${n}`, { waitUntil: "networkidle" });
  await tab.waitForSelector(".issue-page[data-settled]");
  const [download] = await Promise.all([tab.waitForEvent("download", { timeout: 120_000 }), tab.getByRole("button", { name: "Download" }).click()]);
  await download.saveAs(out);
  await tab.locator(".issue-page").screenshot({ path: out.replace(/\.png$/, "-live.png") });
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
