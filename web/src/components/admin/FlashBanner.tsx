/**
 * Renders the flash messages `@/lib/flash` reads back out of a page's
 * `searchParams`, styled exactly like the Jinja admin templates'
 * `get_flashed_messages()` blocks (`app/templates/admin/*.html`).
 */

import type { FlashMessage, FlashType } from "@/lib/flash";

const STYLES: Record<FlashType, string> = {
  success: "border-green-600 bg-green-50 text-green-900",
  error: "border-red-600 bg-red-50 text-red-900",
  warning: "border-amber-500 bg-amber-50 text-amber-900",
  info: "border-blue-500 bg-blue-50 text-blue-900",
};

export default function FlashBanner({ messages }: { messages: FlashMessage[] }) {
  if (messages.length === 0) return null;
  return (
    <div className="mb-6 space-y-2">
      {messages.map((message, index) => (
        <div
          key={index}
          className={`px-4 py-3 text-sm font-sans border-l-4 ${STYLES[message.type]}`}
        >
          {message.text}
        </div>
      ))}
    </div>
  );
}
