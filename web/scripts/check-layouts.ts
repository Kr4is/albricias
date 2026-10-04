/**
 * Measures how well every front-page layout fills its page: each layout at
 * a range of article counts, rendered in headless Chromium on `/dev/layouts`
 * (made-up articles, the generator's own page-fill pass), then scanned for
 * the largest hole — a rectangle of paper with no text, picture or chart in
 * it. Layouts may switch to a roomier one as the generator does (`V4→V6`);
 * what is measured is the page that ends up on screen. A good front page has none to speak of; a layout with empty grid
 * tracks or a column that stops short has a big one.
 *
 * Needs the dev server running (`npm run dev`) and a Chromium that
 * playwright-core can find (`CHROMIUM_PATH` to point at one).
 *   npx tsx scripts/check-layouts.ts [--max-hole=<px²>] [--layout=3] [--n=4]
 */
import { chromium, type Browser } from "playwright-core";
import { layoutsFor } from "../src/lib/layout";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
/** The sheet is `max-w-[1600px]`: a laptop, a desktop, and the widest it gets. */
const WIDTHS = [1280, 1440, 1700];
const LAYOUTS = [1, 2, 3, 4, 5, 6];
const COUNTS = [1, 2, 3, 4, 5, 6, 8, 10];

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const maxHole = Number(arg("max-hole") ?? 80_000);
const onlyLayout = arg("layout");
const onlyCount = arg("n");

interface Measure {
  height: number;
  coverage: number;
  hole: { w: number; h: number; area: number; x: number; y: number };
  settled: boolean;
  layout: number;
}

/** Runs in the page: coverage on a coarse grid, and the largest empty rectangle on it. */
function measure(): Measure {
  const page = document.querySelector<HTMLElement>(".issue-page")!;
  const box = page.getBoundingClientRect();
  const CELL = 12;
  const PAD = 8;
  const cols = Math.ceil(box.width / CELL);
  const rows = Math.ceil(box.height / CELL);
  const covered = new Uint8Array(cols * rows);
  const mark = (r: DOMRect) => {
    if (r.width < 1 || r.height < 1) return;
    const x0 = Math.max(0, Math.floor((r.left - box.left - PAD) / CELL));
    const x1 = Math.min(cols - 1, Math.floor((r.right - box.left + PAD) / CELL));
    const y0 = Math.max(0, Math.floor((r.top - box.top - PAD) / CELL));
    const y1 = Math.min(rows - 1, Math.floor((r.bottom - box.top + PAD) / CELL));
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) covered[y * cols + x] = 1;
  };
  const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  while (walker.nextNode()) {
    if (!walker.currentNode.textContent?.trim()) continue;
    range.selectNodeContents(walker.currentNode);
    for (const r of range.getClientRects()) mark(r);
  }
  for (const el of page.querySelectorAll("img, canvas, .article-facts, .article-repos, svg")) mark(el.getBoundingClientRect());
  // Ruled lines are ink too: a band break drawn with a rule isn't a hole.
  for (const el of page.querySelectorAll("*")) {
    const style = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (parseFloat(style.borderTopWidth) > 0) mark(new DOMRect(r.left, r.top, r.width, parseFloat(style.borderTopWidth)));
    if (parseFloat(style.borderBottomWidth) > 0) mark(new DOMRect(r.left, r.bottom - parseFloat(style.borderBottomWidth), r.width, parseFloat(style.borderBottomWidth)));
  }

  // Largest empty rectangle: row-by-row histogram of empty cells above.
  const heights = new Array<number>(cols).fill(0);
  let best = { w: 0, h: 0, area: 0, x: 0, y: 0 };
  let coveredCells = 0;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const c = covered[y * cols + x];
      coveredCells += c;
      heights[x] = c ? 0 : heights[x] + 1;
    }
    const stack: number[] = [];
    for (let x = 0; x <= cols; x += 1) {
      const h = x === cols ? 0 : heights[x];
      while (stack.length && heights[stack[stack.length - 1]] >= h) {
        const top = stack.pop()!;
        const height = heights[top];
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const width = x - left;
        if (width * height * CELL * CELL > best.area) {
          best = { w: width * CELL, h: height * CELL, area: width * height * CELL * CELL, x: left * CELL, y: (y - height + 1) * CELL };
        }
      }
      stack.push(x);
    }
  }
  return {
    height: Math.round(box.height),
    coverage: coveredCells / (cols * rows),
    hole: best,
    settled: page.dataset.settled === "1",
    layout: Number(page.dataset.layout),
  };
}

/** Every layout × count at one window width; the number of cases with a hole. */
async function checkWidth(browser: Browser, width: number): Promise<number> {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  // tsx (esbuild) wraps named functions in `__name(...)`; `measure` is serialised into the page, which has no such helper.
  await context.addInitScript("window.__name = (fn) => fn;");
  let failures = 0;
  for (const layout of LAYOUTS) {
    if (onlyLayout && Number(onlyLayout) !== layout) continue;
    for (const n of COUNTS) {
      if (onlyCount && Number(onlyCount) !== n) continue;
      // The picker never offers a layout below its minimum (`layoutsFor`).
      if (!layoutsFor(n).includes(layout as 1)) continue;
      const tab = await context.newPage();
      await tab.goto(`${BASE}/dev/layouts?layout=${layout}&n=${n}&repick=1`, { waitUntil: "networkidle" });
      await tab.waitForSelector(".issue-page[data-settled]", { timeout: 20_000 });
      const m = (await tab.evaluate(measure)) as Measure;
      await tab.close();
      // The page's own bottom margin isn't a hole in the page.
      const trailing = m.hole.y + m.hole.h >= m.height - 12 && m.hole.h <= 100;
      const bad = m.hole.area > maxHole && !trailing;
      if (bad) failures += 1;
      console.log(
        `${width}  V${layout}${m.layout === layout ? "  " : `→V${m.layout}`}  ${String(n).padStart(2)}  ->  ${String(m.height).padStart(5)}px  ${(m.coverage * 100).toFixed(0).padStart(3)}%  ${String(m.hole.w).padStart(4)}×${String(m.hole.h).padEnd(4)} @${m.hole.x},${m.hole.y}  ${bad ? "HOLE" : ""}`,
      );
    }
  }
  await context.close();
  return failures;
}

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  console.log("width  layout  n  ->  page height  coverage  largest hole (w×h, at x,y)");
  let failures = 0;
  for (const width of WIDTHS) failures += await checkWidth(browser, width);
  await browser.close();
  if (failures > 0) {
    console.error(`\n${failures} case(s) leave a hole larger than ${maxHole}px².`);
    process.exit(1);
  }
  console.log("\nlayouts self-check: OK");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
