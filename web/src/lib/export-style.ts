/**
 * Keeps a story's text from overlapping its neighbours in the PNG export.
 *
 * `html-to-image` re-lays the page out inside an SVG `foreignObject`, copying
 * every element's *computed* style onto the clone as inline style — `height`
 * included, as a fixed pixel value. For an element split across the columns
 * of an `.issue-flow` that value is one fragment's height (or the whole
 * story's), which is wrong for the clone's own column breaks: the text spills
 * out of its fixed-height box and prints over what follows. Firefox, which
 * returns a full `cssText` for computed style, copies all of it; Chromium
 * copies property by property, with the same effect.
 *
 * So while an export runs, `getComputedStyle` reports no `height` (or
 * `block-size`) for any element that has content: it keeps the height its
 * content gives it, and a column flow re-balances itself. Elements with
 * nothing inside them — a rule drawn as a 1px-high box, the picture's
 * placeholder — keep theirs, since without content their height *is* the
 * element. Pseudo-element styles are left alone.
 */

const FLOW_PROPERTIES = new Set(["height", "block-size"]);

const hasContent = (element: Element) => element.childNodes.length > 0;

/** Runs `render` with `getComputedStyle` patched as described above, restoring it afterwards. */
export async function withNaturalHeights<T>(render: () => Promise<T>): Promise<T> {
  const original = window.getComputedStyle;
  window.getComputedStyle = function (element: Element, pseudo?: string | null) {
    const style = original.call(window, element, pseudo);
    if (pseudo) return style;
    const dropHeight = hasContent(element);
    return new Proxy(style, {
      get(target, property) {
        // An empty `cssText` makes `html-to-image` copy property by property, through `getPropertyValue`.
        if (property === "cssText") return "";
        if (property === "getPropertyValue") {
          return (name: string) => (dropHeight && FLOW_PROPERTIES.has(name) ? "" : target.getPropertyValue(name));
        }
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  } as typeof window.getComputedStyle;
  try {
    return await render();
  } finally {
    window.getComputedStyle = original;
  }
}
