/**
 * Settings content — factored out of `page.tsx` so the real page
 * (`/admin/settings`, direct visit or refresh) and the intercepted modal
 * route (`@modal/(.)settings`, opened from the dashboard) render the exact
 * same thing instead of two copies that could drift. Neither breadcrumb nor
 * page chrome lives here — each caller wraps this differently (a
 * `NewspaperShell` + breadcrumb for the real page, a `Modal` for the
 * intercepted one).
 *
 * Category/field metadata (labels, placeholders, defaults, which fields are
 * secrets) lives in `./field-specs.ts`'s `SETTINGS_CATEGORIES`, and the field
 * renderers live in `./fields.tsx` — both shared with the `/setup`
 * onboarding wizard's steps so the two surfaces render/save the exact same
 * fields rather than duplicating the list or the markup.
 *
 * Every field shows its current effective value's *source* — "using saved
 * setting" (a DB row exists) or "not configured" (only a hardcoded default
 * if any). Secret fields (API keys, client secrets, the SMTP password) never
 * round-trip a decrypted value into the page's HTML: their inputs render
 * blank with a "leave blank to keep the current value" placeholder, and the
 * route handlers only overwrite a field when the submitted value is
 * non-empty — an untouched secret field is a no-op, not an accidental clear.
 */

import FlashBanner from "@/components/admin/FlashBanner";
import type { FlashMessage } from "@/lib/flash";
import { getSetting } from "@/lib/config/settings";
import { getServiceToken } from "@/lib/service-token";
import { resolveAiModel } from "@/lib/ai/provider";
import { settingDisplay } from "./setting-display";
import { SETTINGS_CATEGORIES } from "./field-specs";
import { CategoryFormFields, resolveFieldValues } from "./fields";

/**
 * Permanent connection-status badge for the categories whose "configured?"
 * state also gates a source in `populateEditionDraft`
 * (`@/lib/generation/index.ts`) — shown next to the card title so the admin
 * doesn't have to generate an edition first to see it. `undefined` (any
 * other category) renders nothing.
 */
function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 text-[9px] font-sans font-bold uppercase tracking-widest border ${
        connected
          ? "border-green-600 bg-green-50 text-green-900"
          : "border-amber-500 bg-amber-50 text-amber-900"
      }`}
    >
      {connected ? "Connected" : "Not configured"}
    </span>
  );
}

function Card({
  title,
  description,
  action,
  testAction,
  connected,
  children,
}: {
  title: string;
  description?: string;
  action: string;
  /** When set, renders a secondary "Test connection" action below Save — see its doc comment for why "saved" and "works" are checked separately. */
  testAction?: string;
  connected?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-stone-200 bg-white p-6">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-xs font-sans font-bold uppercase tracking-widest text-stone-600">
          {title}
        </h3>
        {connected !== undefined && <ConnectionBadge connected={connected} />}
      </div>
      {description && <p className="text-xs font-serif text-stone-500 mb-4">{description}</p>}
      <form method="POST" action={action} className="space-y-3" data-loading-submit>
        {children}
        <button
          type="submit"
          data-loading-text="Saving…"
          className="w-full px-3 py-2 text-xs font-bold uppercase tracking-widest bg-ink text-paper hover:bg-ink-light transition-colors mt-2"
        >
          Save
        </button>
      </form>
      {testAction && (
        <form method="POST" action={testAction} className="mt-2" data-loading-submit>
          <button
            type="submit"
            data-loading-text="Testing…"
            className="w-full px-3 py-2 text-xs font-bold uppercase tracking-widest border border-stone-300 text-stone-600 hover:border-ink hover:text-ink transition-colors"
          >
            Test connection
          </button>
        </form>
      )}
    </div>
  );
}

export default async function SettingsPanel({ messages }: { messages: FlashMessage[] }) {
  const allFields = SETTINGS_CATEGORIES.flatMap((category) => category.fields);
  const values = await resolveFieldValues(allFields, settingDisplay);

  // Same presence checks `populateEditionDraft` (`@/lib/generation/index.ts`)
  // uses to decide whether to fetch each source — reused here verbatim so
  // this badge never drifts from what actually gates generation.
  const [
    githubToken,
    githubUsername,
    blogRssUrl,
    alexandriaApiUrl,
    spotifyToken,
    aiModel,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPass,
    fromAddress,
  ] = await Promise.all([
    getSetting("integrations.github.token", { encrypted: true }),
    getSetting("integrations.github.username"),
    getSetting("integrations.blog.rssUrl"),
    getSetting("integrations.alexandria.apiUrl"),
    getServiceToken("spotify"),
    resolveAiModel(),
    getSetting("email.smtpHost"),
    getSetting("email.smtpPort"),
    getSetting("email.smtpUser"),
    getSetting("email.smtpPass", { encrypted: true }),
    getSetting("email.fromAddress"),
  ]);
  const connectionStatus: Record<string, boolean> = {
    github: Boolean(githubToken && githubUsername),
    blog: Boolean(blogRssUrl),
    spotify: Boolean(spotifyToken),
    alexandria: Boolean(alexandriaApiUrl),
    ai: Boolean(aiModel),
    email: Boolean(smtpHost && smtpPort && smtpUser && smtpPass && fromAddress),
  };

  // The three categories with a cheap, real "does it actually work" check —
  // see each route under ./<category>/test/route.ts. The rest only have a
  // "saved" check (connectionStatus above); extending this list is future
  // work, not a limitation of the Card component itself.
  const testableCategories = new Set(["ai", "github", "email"]);

  return (
    <>
      <p className="text-xs font-serif text-stone-500 mb-6 max-w-2xl">
        Every credential is configured here — there is no `.env` fallback.
        Saved values take effect immediately, no restart needed.
      </p>

      <FlashBanner messages={messages} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {SETTINGS_CATEGORIES.map((category) => (
          <Card
            key={category.id}
            title={category.title}
            description={category.description}
            action={`/admin/settings/${category.id}`}
            testAction={
              testableCategories.has(category.id) ? `/admin/settings/${category.id}/test` : undefined
            }
            connected={connectionStatus[category.id]}
          >
            <CategoryFormFields fields={category.fields} values={values} />
          </Card>
        ))}
      </div>
    </>
  );
}
