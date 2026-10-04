/**
 * Measuring and levelling the front page's side-by-side columns, so every
 * column's last line ends at the same height. Pure DOM — no React — driven
 * by `usePageFill` once the page has settled.
 *
 * Markup contract (set by the `IssueV*` layouts):
 *   - `[data-balance-group]` wraps columns that sit side by side; its direct
 *     `[data-balance-col]` children are the columns to level.
 *   - `[data-fold-group]` marks a layout whose side rail holds the first
 *     `fold` secondary stories, the rest going to a balanced band below:
 *     `[data-fold-main]` is the lead's column, `[data-fold-rail]` the rail
 *     (holding `[data-story]` stories separated by `[data-rail-rule]`s,
 *     under an optional `[data-rail-head]`), and the group's `data-fold`
 *     attribute the current fold.
 *
 * Runs of equal columns (dispatch grids, "More News" bars) are CSS
 * multi-column flows (`.issue-flow`), which the browser balances by itself
 * — to within whatever a picture or chart that can't split across columns
 * leaves over; `levelFlows` tunes their type size to close that too.
 */

/** Two columns within this many px count as level — about one line of body type. */
const LEVEL_TOLERANCE_PX = 24;
/** Most a short column's type may grow to catch up — beyond this the size difference shows. */
const MAX_COL_SCALE = 1.15;
/** Extra space between one story's paragraphs past this reads as holes in the text — leave the column short instead. */
const MAX_PARAGRAPH_GAP_PX = 40;
/** A gap between two stories wider than this reads as a hole in the page, not breathing room. */
export const MAX_SPREAD_GAP_PX = 140;

/** Height from a column's top to the bottom of its last child — its content, not its (grid-stretched) box. */
function contentHeight(col: HTMLElement): number {
  const top = col.getBoundingClientRect().top;
  let bottom = top;
  for (const child of col.children) {
    const rect = child.getBoundingClientRect();
    if (rect.height > 0) bottom = Math.max(bottom, rect.bottom);
  }
  return bottom - top;
}

function columnsOf(group: Element): HTMLElement[] {
  return [...group.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.hasAttribute("data-balance-col"));
}

/** Undo a previous pass, so a re-run measures natural heights. */
export function resetBalance(root: HTMLElement) {
  for (const el of root.querySelectorAll<HTMLElement>("[data-balance-col], .issue-flow")) {
    el.style.removeProperty("--col-scale");
    el.removeAttribute("data-spread");
    el.removeAttribute("data-spread-inner");
  }
}

/** Nothing on the page has a visible box yet (a lazy image still at 0×0, an empty text run). */
function painted(rect: DOMRect) {
  return rect.width >= 1 && rect.height >= 1;
}

/**
 * Where each column of a multi-column flow actually ends: the lowest line
 * of text, picture or chart falling in it. Measured from text line boxes,
 * because a flow's children are fragmented across columns and their own
 * boxes don't say which column holds what.
 */
function flowColumnBottoms(flow: HTMLElement): number[] {
  const count = Number.parseInt(getComputedStyle(flow).columnCount, 10) || 1;
  const box = flow.getBoundingClientRect();
  const width = box.width / count;
  const bottoms: (number | null)[] = new Array(count).fill(null);
  const add = (rect: DOMRect) => {
    if (!painted(rect)) return;
    const index = Math.min(count - 1, Math.max(0, Math.floor((rect.left + rect.width / 2 - box.left) / width)));
    bottoms[index] = Math.max(bottoms[index] ?? 0, rect.bottom);
  };
  const walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  while (walker.nextNode()) {
    if (!walker.currentNode.textContent?.trim()) continue;
    range.selectNodeContents(walker.currentNode);
    for (const rect of range.getClientRects()) add(rect);
  }
  for (const el of flow.querySelectorAll("img, canvas")) add(el.getBoundingClientRect());
  return bottoms.filter((bottom): bottom is number => bottom !== null);
}

/** Candidate type sizes for a flow — small enough steps that one of them usually lands every column on the same line. */
const FLOW_SCALES = Array.from({ length: 11 }, (_, i) => 1 + i * 0.01);

/**
 * For each flow, the type size (of `FLOW_SCALES`) whose columns end most
 * nearly level — the browser balances the copy, but a picture or chart
 * can't split, which can leave a column a few lines short; nudging the
 * size reflows every line and usually closes it. Keeps the smallest size
 * among equally good ones, and 1 when the flow is already level.
 */
export function levelFlows(root: HTMLElement) {
  for (const flow of root.querySelectorAll<HTMLElement>(".issue-flow")) {
    let best = { scale: 1, spread: Infinity };
    for (const scale of FLOW_SCALES) {
      flow.style.setProperty("--col-scale", String(scale));
      const bottoms = flowColumnBottoms(flow);
      if (bottoms.length < 2) {
        best = { scale: 1, spread: 0 };
        break;
      }
      const spread = Math.max(...bottoms) - Math.min(...bottoms);
      if (spread < best.spread - 1) best = { scale, spread };
      if (spread <= 2) break;
    }
    flow.style.setProperty("--col-scale", String(best.scale));
  }
}

/**
 * Works out the fold from one measurement of the page as rendered with
 * every secondary story on the rail: each story's height, the space a rule
 * between two stories takes, and the lead column's height. Returns the
 * largest number of stories that fit beside the lead — the rest run in the
 * band below. `null` when the layout has no fold, or nothing has been
 * measured yet.
 */
export function planFold(root: HTMLElement): number | null {
  const group = root.querySelector<HTMLElement>("[data-fold-group]");
  const main = group?.querySelector<HTMLElement>("[data-fold-main]");
  const rail = group?.querySelector<HTMLElement>("[data-fold-rail]");
  if (!group || !main || !rail) return null;

  const stories = [...rail.querySelectorAll<HTMLElement>("[data-story]")];
  if (stories.length === 0) return 0;
  const heights = stories.map((story) => story.getBoundingClientRect().height);

  // The space one story adds beyond its own height: gap, rule, gap.
  const gap = Number.parseFloat(getComputedStyle(rail).rowGap) || 0;
  const between = stories.length >= 2 ? stories[1].getBoundingClientRect().top - stories[0].getBoundingClientRect().bottom : gap * 2 + 1;
  // Whatever sits above the rail's first story (V4's "In Brief" head).
  const head = rail.querySelector<HTMLElement>("[data-rail-head]");
  const base = head
    ? head.getBoundingClientRect().bottom - rail.getBoundingClientRect().top + (Number.parseFloat(getComputedStyle(head).marginBottom) || 0) + gap
    : 0;

  const limit = contentHeight(main) + LEVEL_TOLERANCE_PX;
  let n = heights.length;
  while (n > 0 && base + heights.slice(0, n).reduce((a, b) => a + b, 0) + between * (n - 1) > limit) n -= 1;
  return n;
}

/**
 * The fold group's rail, when it runs longer than the lead's
 * column — the signal to move a story below the fold. `null` when the
 * layout has no fold, or it can't shrink further.
 */
export function foldOverflows(root: HTMLElement): { fold: number } | null {
  const group = root.querySelector<HTMLElement>("[data-fold-group]");
  if (!group) return null;
  const fold = Number(group.dataset.fold);
  const main = group.querySelector<HTMLElement>("[data-fold-main]");
  const rail = group.querySelector<HTMLElement>("[data-fold-rail]");
  if (!main || !rail || !(fold > 0)) return null;
  return contentHeight(rail) > contentHeight(main) + LEVEL_TOLERANCE_PX ? { fold } : null;
}

/**
 * Levels every balance group: each column shorter than the group's
 * tallest first gets slightly larger type (binary search on `--col-scale`,
 * never past the tallest), then shares out whatever it still lacks as
 * space between its stories. Returns the widest gap that left between two
 * stories, or the shortfall of a column with nothing to spread across —
 * the caller treats a large one as "this layout can't hold this content".
 */
export function balanceColumns(root: HTMLElement): number {
  let worst = 0;
  for (const group of root.querySelectorAll("[data-balance-group]")) {
    const cols = columnsOf(group);
    if (cols.length < 2) continue;
    const target = Math.max(...cols.map(contentHeight));

    for (const col of cols) {
      if (contentHeight(col) >= target - LEVEL_TOLERANCE_PX) continue;

      let lo = 1;
      let hi = MAX_COL_SCALE;
      for (let i = 0; i < 6; i += 1) {
        const mid = (lo + hi) / 2;
        col.style.setProperty("--col-scale", mid.toFixed(3));
        if (contentHeight(col) <= target) lo = mid;
        else hi = mid;
      }
      col.style.setProperty("--col-scale", lo.toFixed(3));

      const shortfall = target - contentHeight(col);
      if (shortfall < LEVEL_TOLERANCE_PX) continue;
      const blocks = [...col.children].filter((el) => el.getBoundingClientRect().height > 0);
      if (blocks.length >= 2) {
        col.setAttribute("data-spread", "");
        worst = Math.max(worst, shortfall / (blocks.length - 1));
        continue;
      }
      // One story alone: share the shortfall between its paragraphs
      // instead — unless its body is itself multi-column, which a flex
      // container would flatten.
      const body = blocks[0]?.querySelector<HTMLElement>(".article-body");
      const paragraphs = body ? body.children.length : 0;
      if (body && paragraphs >= 2 && getComputedStyle(body).columnCount === "auto" && shortfall / (paragraphs - 1) <= MAX_PARAGRAPH_GAP_PX) {
        col.setAttribute("data-spread-inner", "");
        worst = Math.max(worst, shortfall / (paragraphs - 1));
      } else {
        worst = Math.max(worst, shortfall);
      }
    }
  }
  return worst;
}
