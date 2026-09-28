/**
 * Prints one signed image URL. Run in a fresh process by
 * `check-images.ts`'s boot-secret check — never invoked directly.
 */
import { proxiedImageUrl } from "../src/lib/image-proxy";

console.log(proxiedImageUrl("https://example.org/probe.png"));
