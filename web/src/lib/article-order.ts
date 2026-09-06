import { prisma } from "@/lib/prisma";

/**
 * Next free `order` within an edition (`max(order) + 1`, or `1` when empty).
 *
 * A separate, admin-routes-only twin of the private helper of the same shape
 * in `@/lib/generation` — that module belongs to Phase 2 and is not touched
 * here, so this is a small independent implementation, not a shared import.
 */
export async function nextArticleOrder(editionId: number): Promise<number> {
  const { _max } = await prisma.article.aggregate({
    where: { editionId },
    _max: { order: true },
  });
  return (_max.order ?? 0) + 1;
}
