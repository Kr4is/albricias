import { prisma } from "@/lib/prisma";

/**
 * Next free `order` within an edition (`max(order) + 1`, or `1` when empty).
 *
 * A separate twin of the private helper of the same shape in
 * `@/lib/generation` — that module owns its own copy, so this is a small
 * independent implementation, not a shared import. Originally written for the
 * admin routes alone; `@/lib/synthesis` now consumes this file too (via
 * {@link leadArticleOrder}), so it is no longer admin-only.
 */
export async function nextArticleOrder(editionId: number): Promise<number> {
  const { _max } = await prisma.article.aggregate({
    where: { editionId },
    _max: { order: true },
  });
  return (_max.order ?? 0) + 1;
}

/**
 * An `order` strictly below every article already in the edition, and always
 * `<= -1`.
 *
 * Negative `order` values are new to this codebase: every organic creation
 * path goes through {@link nextArticleOrder} and starts at `1`, so nothing
 * else ever produces one. That novelty is the point — the lead story has to
 * be structurally first, and the plain `min(order) - 1` would evaluate to
 * exactly `0` on any standard edition, colliding with `Article.order`'s own
 * schema default. Clamping the minimum at `0` before subtracting guarantees
 * the result is negative and therefore unambiguously first under
 * `ARTICLE_ORDER`'s sort. Nothing in the ordering path floors or clamps
 * `order`, so a negative value sorts normally everywhere it is read.
 */
export async function leadArticleOrder(editionId: number): Promise<number> {
  const { _min } = await prisma.article.aggregate({
    where: { editionId },
    _min: { order: true },
  });
  return Math.min(_min.order ?? 1, 0) - 1;
}
