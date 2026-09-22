/**
 * Settings content — factored out of `page.tsx` so the real page
 * (`/admin/settings`, direct visit or refresh) and the intercepted modal
 * route (`@modal/(.)settings`, opened from the dashboard) render the exact
 * same thing instead of two copies that could drift. Neither breadcrumb nor
 * page chrome lives here — each caller wraps this differently (a
 * `NewspaperShell` + breadcrumb for the real page, a `Modal` for the
 * intercepted one).
 *
 * Organized into three sections — the user's own framing for what used to
 * be one flat grid of 9 unrelated categories plus two more pages
 * (`/admin/cadence`, `/admin/account`) entirely outside Settings:
 *
 *   1. AI Generation — the one thing that decides how articles get written.
 *   2. Service Connections — every external source/destination (GitHub,
 *      blog, Spotify, Google Calendar, X, Alexandria), each showing not just
 *      "is a credential saved" but, for the three OAuth ones, "is the
 *      *account* actually connected" — and never offering a Connect action
 *      that's guaranteed to bounce back with an error because the OAuth
 *      app's client ID/secret isn't saved yet (see the gated `<span>`
 *      fallback in each of the three).
 *   3. Newspaper Configuration — Branding, Email, and (transplanted here
 *      verbatim from the now-deleted `/admin/cadence` and `/admin/account`
 *      pages) Cadence and Account. Neither fits the generic
 *      `SETTINGS_CATEGORIES`/`CategoryFormFields` shape (a cron expression,
 *      a password-confirm pair), so they're bespoke cards rather than one
 *      more field-spec entry.
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
import Disclosure from "@/components/admin/Disclosure";
import type { FlashMessage } from "@/lib/flash";
import { getSetting } from "@/lib/config/settings";
import { getServiceToken } from "@/lib/service-token";
import { getSocialAccount } from "@/lib/social/store";
import { resolveAiModelFor, type AiProviderId } from "@/lib/ai/provider";
import { getCadence } from "@/lib/cadence";
import { CADENCE_MONTHLY, CADENCE_WEEKLY } from "@/lib/edition-helpers";
import {
  DEFAULT_DAILY_SCHEDULE_CRON,
  DEFAULT_SCHEDULE_CRON,
  getDailyScheduleSettings,
  getScheduleSettings,
  nextDailyScheduledRun,
  nextScheduledRun,
} from "@/lib/scheduler";
import { settingDisplay } from "./setting-display";
import { SETTINGS_CATEGORIES, AI_FIELDS, findCategory } from "./field-specs";
import { CategoryFormFields, resolveFieldValues } from "./fields";
import { AI_PROVIDER_LABELS } from "./ai/provider-param";

/**
 * Permanent connection-status badge for the categories whose "configured?"
 * state also gates a source in `populateEditionDraft`
 * (`@/lib/generation/index.ts`) — shown next to the card title so the admin
 * doesn't have to generate an edition first to see it, and next to a
 * collapsed card's title so that's true even without opening it.
 * `undefined` (any other category) renders nothing. `active` (the one AI
 * provider `ai.provider` currently points at) takes precedence over both.
 */
function ConnectionBadge({ connected, active = false }: { connected: boolean; active?: boolean }) {
  if (active) {
    return (
      <span className="inline-block px-2 py-0.5 text-[9px] font-sans font-bold uppercase tracking-widest border border-ink bg-ink text-paper">
        Active
      </span>
    );
  }
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

/**
 * A category's card — collapsed by default (just the title + status badge)
 * so a page of many services reads as a status list first, a form only once
 * you actually need to change something. `<details>`-based (`Disclosure`),
 * not new client state, matching this app's minimal-JS ethos.
 */
function Card({
  title,
  description,
  action,
  testAction,
  connected,
  active,
  extra,
  children,
}: {
  title: string;
  description?: string;
  action: string;
  /** When set, renders a secondary "Test connection" action below Save — see its doc comment for why "saved" and "works" are checked separately. */
  testAction?: string;
  connected?: boolean;
  /** The one AI provider currently selected in `ai.provider` — see `ConnectionBadge`. */
  active?: boolean;
  /** Extra content below Save/Test — the account-level Connect/Disconnect, "Manage →", or "Set as active" block. */
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Disclosure
      persistKey={action}
      summary={
        <span className="flex items-center gap-2">
          <span>{title}</span>
          {(connected !== undefined || active) && (
            <ConnectionBadge connected={Boolean(connected)} active={active} />
          )}
        </span>
      }
    >
      {description && <p className="text-xs font-serif text-stone-500 mb-4 mt-3">{description}</p>}
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
      {extra && <div className="mt-4 pt-4 border-t border-stone-100">{extra}</div>}
    </Disclosure>
  );
}

/** Section header — the visual separator between the three groups. */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-12 last:mb-0">
      <h3 className="font-headline text-xl font-bold border-b-2 border-ink pb-2 mb-2">{title}</h3>
      {description && (
        <p className="text-xs font-serif text-stone-500 mb-5 max-w-2xl">{description}</p>
      )}
      {/* items-start: without it, CSS Grid's default row-stretch makes a
          collapsed card in one column visually grow to match an expanded
          card next to it in the same row — reading as if it had opened too,
          empty, even though its own <details> stayed closed. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">{children}</div>
    </section>
  );
}

/** A gated "do the OAuth thing" affordance — a real link once the app credentials exist, a plain explanation otherwise. */
function OAuthAction({
  appConfigured,
  connected,
  connectHref,
  connectLabel,
  disconnectAction,
  disconnectConfirm,
  manageHref,
}: {
  appConfigured: boolean;
  connected: boolean;
  connectHref: string;
  connectLabel: string;
  disconnectAction?: string;
  disconnectConfirm?: string;
  /** When set (Google/X), a "Manage →" link to the richer dedicated page instead of an inline Disconnect form. */
  manageHref?: string;
}) {
  if (!appConfigured) {
    return (
      <p className="text-xs font-sans text-stone-400 italic">
        Set the client ID and secret above, then save, to connect your account.
      </p>
    );
  }
  if (connected && manageHref) {
    return (
      <a
        href={manageHref}
        className="inline-flex items-center gap-1 text-xs font-bold font-sans uppercase tracking-widest text-ink hover:underline"
      >
        Manage connection <span className="material-icons text-sm">arrow_forward</span>
      </a>
    );
  }
  if (connected && disconnectAction) {
    return (
      <form method="POST" action={disconnectAction} data-confirm={disconnectConfirm} data-loading-submit>
        <button
          type="submit"
          data-loading-text="Disconnecting…"
          className="w-full px-3 py-2 text-xs font-bold uppercase tracking-widest border border-stone-300 text-stone-500 hover:border-red-400 hover:text-red-700 transition-colors"
        >
          Disconnect
        </button>
      </form>
    );
  }
  if (manageHref) {
    return (
      <a
        href={manageHref}
        className="inline-flex items-center gap-1 text-xs font-bold font-sans uppercase tracking-widest text-ink hover:underline"
      >
        Manage connection <span className="material-icons text-sm">arrow_forward</span>
      </a>
    );
  }
  return (
    <a
      href={connectHref}
      className="block text-center px-3 py-2 text-xs font-bold uppercase tracking-widest border border-ink hover:bg-stone-100 transition-colors"
    >
      {connectLabel}
    </a>
  );
}

/**
 * "Set as active" for one AI provider card — a provider can be fully
 * configured and tested without being the one `ai.provider` points at (the
 * whole point of per-provider cards: keep several ready, switch which one
 * generation actually uses with one click). Not offered for an unconfigured
 * provider — nothing to switch to yet — or for the provider already active.
 */
function ActivateAction({
  configured,
  active,
  activateAction,
}: {
  configured: boolean;
  active: boolean;
  activateAction: string;
}) {
  if (active) {
    return <p className="text-xs font-sans text-stone-500">This is the active provider.</p>;
  }
  if (!configured) {
    return (
      <p className="text-xs font-sans text-stone-400 italic">
        Configure and save the fields above to make this provider usable.
      </p>
    );
  }
  return (
    <form method="POST" action={activateAction} data-loading-submit>
      <button
        type="submit"
        data-loading-text="Switching…"
        className="w-full px-3 py-2 text-xs font-bold uppercase tracking-widest border border-ink hover:bg-stone-100 transition-colors"
      >
        Use this provider
      </button>
    </form>
  );
}

/** Non-null wrapper around `findCategory` — every id used below is a literal from `SETTINGS_CATEGORIES` itself. */
function category(id: string) {
  const found = findCategory(id);
  if (!found) throw new Error(`Unknown settings category "${id}".`);
  return found;
}

export default async function SettingsPanel({ messages }: { messages: FlashMessage[] }) {
  const allFields = SETTINGS_CATEGORIES.flatMap((cat) => cat.fields);

  const [
    values,
    githubToken,
    githubUsername,
    blogRssUrl,
    tavilyApiKey,
    alexandriaApiUrl,
    spotifyToken,
    spotifyClientId,
    spotifyClientSecret,
    googleToken,
    googleClientId,
    googleClientSecret,
    twitterAccount,
    twitterClientId,
    twitterClientSecret,
    activeProvider,
    litellmResolved,
    openaiResolved,
    ollamaResolved,
    geminiResolved,
    smtpHost,
    smtpPort,
    smtpUser,
    smtpPass,
    fromAddress,
    cadence,
    schedule,
    dailySchedule,
  ] = await Promise.all([
    resolveFieldValues(allFields, settingDisplay),
    getSetting("integrations.github.token", { encrypted: true }),
    getSetting("integrations.github.username"),
    getSetting("integrations.blog.rssUrl"),
    getSetting("integrations.tavily.apiKey", { encrypted: true }),
    getSetting("integrations.alexandria.apiUrl"),
    getServiceToken("spotify"),
    getSetting("integrations.spotify.clientId"),
    getSetting("integrations.spotify.clientSecret", { encrypted: true }),
    getServiceToken("google"),
    getSetting("integrations.google.clientId"),
    getSetting("integrations.google.clientSecret", { encrypted: true }),
    getSocialAccount("twitter"),
    getSetting("integrations.twitter.clientId"),
    getSetting("integrations.twitter.clientSecret", { encrypted: true }),
    getSetting("ai.provider", { default: "litellm" }),
    resolveAiModelFor("litellm"),
    resolveAiModelFor("openai"),
    resolveAiModelFor("ollama"),
    resolveAiModelFor("gemini"),
    getSetting("email.smtpHost"),
    getSetting("email.smtpPort"),
    getSetting("email.smtpUser"),
    getSetting("email.smtpPass", { encrypted: true }),
    getSetting("email.fromAddress"),
    getCadence(),
    getScheduleSettings(),
    getDailyScheduleSettings(),
  ]);

  // Same presence checks `populateEditionDraft` (`@/lib/generation/index.ts`)
  // uses to decide whether to fetch each source — reused here verbatim so
  // this badge never drifts from what actually gates generation.
  const connectionStatus: Record<string, boolean> = {
    github: Boolean(githubToken && githubUsername),
    blog: Boolean(blogRssUrl),
    tavily: Boolean(tavilyApiKey),
    spotify: Boolean(spotifyToken),
    alexandria: Boolean(alexandriaApiUrl),
    email: Boolean(smtpHost && smtpPort && smtpUser && smtpPass && fromAddress),
  };
  const spotifyAppConfigured = Boolean(spotifyClientId && spotifyClientSecret);
  const googleAppConfigured = Boolean(googleClientId && googleClientSecret);
  const twitterAppConfigured = Boolean(twitterClientId && twitterClientSecret);

  // Each provider's own configured state, independent of which one is
  // active — the whole point of separate cards: LiteLLM can be fully working
  // while OpenAI is what's actually selected, and the admin should be able
  // to see and test both.
  const aiProviders: { id: AiProviderId; configured: boolean }[] = [
    { id: "litellm", configured: Boolean(litellmResolved) },
    { id: "openai", configured: Boolean(openaiResolved) },
    { id: "ollama", configured: Boolean(ollamaResolved) },
    { id: "gemini", configured: Boolean(geminiResolved) },
  ];
  const nextRun = schedule.enabled ? nextScheduledRun() : null;
  const nextDailyRun = dailySchedule.enabled ? nextDailyScheduledRun() : null;
  const activeProviderId = (activeProvider ?? "litellm") as AiProviderId;

  return (
    <>
      <p className="text-xs font-serif text-stone-500 mb-8 max-w-2xl">
        Every credential is configured here — there is no `.env` fallback.
        Saved values take effect immediately, no restart needed.
      </p>

      <FlashBanner messages={messages} />

      <Section
        title="AI Generation"
        description="Powers article generation, activity/calendar rankings, and social copy. Configure as many providers as you like and test each independently — one of them is the active provider generation actually uses."
      >
        {aiProviders.map(({ id, configured }) => (
          <Card
            key={id}
            title={AI_PROVIDER_LABELS[id]}
            action={`/admin/settings/ai/${id}`}
            testAction={`/admin/settings/ai/${id}/test`}
            connected={configured}
            active={id === activeProviderId}
            extra={
              <ActivateAction
                configured={configured}
                active={id === activeProviderId}
                activateAction={`/admin/settings/ai/${id}/activate`}
              />
            }
          >
            <CategoryFormFields
              fields={AI_FIELDS.filter((field) => field.providerGroup === id)}
              values={values}
            />
          </Card>
        ))}
      </Section>

      <Section
        title="Service Connections"
        description="Every external source that feeds a generated edition, and every account editions get distributed to."
      >
        <Card
          title={category("github").title}
          description={category("github").description}
          action="/admin/settings/github"
          testAction="/admin/settings/github/test"
          connected={connectionStatus.github}
        >
          <CategoryFormFields fields={category("github").fields} values={values} />
        </Card>

        <Card
          title={category("blog").title}
          description={category("blog").description}
          action="/admin/settings/blog"
          connected={connectionStatus.blog}
        >
          <CategoryFormFields fields={category("blog").fields} values={values} />
        </Card>

        <Card
          title={category("tavily").title}
          description={category("tavily").description}
          action="/admin/settings/tavily"
          connected={connectionStatus.tavily}
        >
          <CategoryFormFields fields={category("tavily").fields} values={values} />
        </Card>

        <Card
          title={category("spotify").title}
          description={category("spotify").description}
          action="/admin/settings/spotify"
          connected={Boolean(spotifyToken)}
          extra={
            <OAuthAction
              appConfigured={spotifyAppConfigured}
              connected={Boolean(spotifyToken)}
              connectHref="/admin/spotify/connect"
              connectLabel="Connect Spotify"
              disconnectAction="/admin/spotify/disconnect"
              disconnectConfirm="Disconnect Spotify? You'll need to reconnect to keep including listening activity in new editions."
            />
          }
        >
          <CategoryFormFields fields={category("spotify").fields} values={values} />
        </Card>

        <Card
          title={category("google").title}
          description={category("google").description}
          action="/admin/settings/google"
          connected={Boolean(googleToken)}
          extra={
            <OAuthAction
              appConfigured={googleAppConfigured}
              connected={Boolean(googleToken)}
              connectHref="/admin/calendar/connect"
              connectLabel="Connect Google Calendar"
              manageHref="/admin/calendar"
            />
          }
        >
          <CategoryFormFields fields={category("google").fields} values={values} />
        </Card>

        <Card
          title={category("twitter").title}
          description={category("twitter").description}
          action="/admin/settings/twitter"
          connected={Boolean(twitterAccount?.enabled)}
          extra={
            <OAuthAction
              appConfigured={twitterAppConfigured}
              connected={Boolean(twitterAccount?.enabled)}
              connectHref="/admin/social/twitter/connect"
              connectLabel="Connect X"
              manageHref="/admin/social"
            />
          }
        >
          <CategoryFormFields fields={category("twitter").fields} values={values} />
        </Card>

        <Card
          title={category("alexandria").title}
          description={category("alexandria").description}
          action="/admin/settings/alexandria"
          connected={connectionStatus.alexandria}
        >
          <CategoryFormFields fields={category("alexandria").fields} values={values} />
        </Card>
      </Section>

      <Section title="Newspaper Configuration" description="Branding, outbound email, publication cadence, and this admin account — nothing here feeds generation or an external connection.">
        <Card title={category("branding").title} description={category("branding").description} action="/admin/settings/branding">
          <CategoryFormFields fields={category("branding").fields} values={values} />
        </Card>

        <Card
          title={category("email").title}
          description={category("email").description}
          action="/admin/settings/email"
          testAction="/admin/settings/email/test"
          connected={connectionStatus.email}
        >
          <CategoryFormFields fields={category("email").fields} values={values} />
        </Card>

        {/* Cadence — transplanted from the now-deleted /admin/cadence page. */}
        <div className="border border-stone-200 bg-white p-6">
          <h3 className="text-xs font-sans font-bold uppercase tracking-widest text-stone-600 mb-4">
            Generation Cadence
          </h3>
          <form method="POST" action="/admin/cadence/update" className="space-y-3" data-loading-submit>
            <label className="flex items-center gap-3 border border-stone-200 p-3 has-[:checked]:border-ink cursor-pointer transition-colors">
              <input
                type="radio"
                name="cadence"
                value={CADENCE_MONTHLY}
                defaultChecked={cadence === CADENCE_MONTHLY}
                className="accent-ink"
              />
              <div>
                <p className="text-xs font-sans font-bold">Monthly</p>
                <p className="text-[10px] font-sans text-stone-500">One edition per calendar month.</p>
              </div>
            </label>
            <label className="flex items-center gap-3 border border-stone-200 p-3 has-[:checked]:border-ink cursor-pointer transition-colors">
              <input
                type="radio"
                name="cadence"
                value={CADENCE_WEEKLY}
                defaultChecked={cadence === CADENCE_WEEKLY}
                className="accent-ink"
              />
              <div>
                <p className="text-xs font-sans font-bold">Weekly</p>
                <p className="text-[10px] font-sans text-stone-500">One edition per ISO week (Monday–Sunday).</p>
              </div>
            </label>
            <button
              type="submit"
              data-loading-text="Saving…"
              className="w-full px-3 py-2 text-xs font-bold uppercase tracking-widest bg-ink text-paper hover:bg-ink-light transition-colors mt-2"
            >
              Save Cadence
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-stone-100">
            <h4 className="text-xs font-sans font-bold uppercase tracking-widest text-stone-600 mb-1">
              Automatic Generation
            </h4>
            <p className="text-[10px] font-sans text-stone-500 mb-3">
              Runs the same pipeline as &quot;Generate with AI&quot; on a schedule, with no admin interaction.
            </p>
            <form method="POST" action="/admin/cadence/schedule" className="space-y-3" data-loading-submit>
              <label className="flex items-center gap-3 border border-stone-200 p-3 has-[:checked]:border-ink cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  name="enabled"
                  value="true"
                  defaultChecked={schedule.enabled}
                  className="accent-ink w-4 h-4"
                />
                <div>
                  <p className="text-xs font-sans font-bold">Enabled</p>
                  <p className="text-[10px] font-sans text-stone-500">
                    When off, the cron expression below is saved but no job runs.
                  </p>
                </div>
              </label>
              <div className="space-y-1">
                <label htmlFor="cronExpr" className="block text-[10px] font-sans font-bold uppercase tracking-widest">
                  Cron expression (UTC)
                </label>
                <input
                  type="text"
                  id="cronExpr"
                  name="cronExpr"
                  defaultValue={schedule.cronExpr ?? DEFAULT_SCHEDULE_CRON}
                  placeholder={DEFAULT_SCHEDULE_CRON}
                  className="w-full bg-white border border-stone-300 focus:border-ink px-3 py-2 text-xs font-mono"
                />
                <p className="text-[10px] font-sans text-stone-500">
                  5-field cron (minute hour day month weekday), e.g.{" "}
                  <code className="font-mono">{DEFAULT_SCHEDULE_CRON}</code> = every Monday at 06:00 UTC.
                </p>
              </div>
              {schedule.enabled && schedule.cronExpr && (
                <p className="text-[10px] font-sans text-stone-500">
                  {nextRun
                    ? `Next scheduled run: ${nextRun.toUTCString()}`
                    : "Schedule is enabled, but no upcoming run could be computed (check the cron expression)."}
                </p>
              )}
              <button
                type="submit"
                data-loading-text="Saving…"
                className="w-full px-3 py-2 text-xs font-bold uppercase tracking-widest bg-ink text-paper hover:bg-ink-light transition-colors mt-2"
              >
                Save Schedule
              </button>
            </form>
          </div>
        </div>

        {/* Daily Processing — the day-by-day generation job, separate from
            the Cadence card above: Cadence decides how long a period is
            (weekly/monthly) and when a new draft is created; this decides
            how often the currently-open draft is walked forward a day at a
            time (fetch that day's activity, write its dispatch, surface
            anything newly interesting). See `@/lib/generation/daily`. */}
        <div className="border border-stone-200 bg-white p-6">
          <h3 className="text-xs font-sans font-bold uppercase tracking-widest text-stone-600 mb-1">
            Daily Processing
          </h3>
          <p className="text-[10px] font-sans text-stone-500 mb-4">
            Once a day, catches the currently-open edition up: fetches that day&apos;s
            activity, writes its dispatch, and surfaces anything newly interesting.
            On the period&apos;s last day, also writes the ranking and front-page compendium.
          </p>
          <form method="POST" action="/admin/daily-schedule" className="space-y-3" data-loading-submit>
            <label className="flex items-center gap-3 border border-stone-200 p-3 has-[:checked]:border-ink cursor-pointer transition-colors">
              <input
                type="checkbox"
                name="enabled"
                value="true"
                defaultChecked={dailySchedule.enabled}
                className="accent-ink w-4 h-4"
              />
              <div>
                <p className="text-xs font-sans font-bold">Enabled</p>
                <p className="text-[10px] font-sans text-stone-500">
                  When off, the cron expression below is saved but no job runs.
                </p>
              </div>
            </label>
            <div className="space-y-1">
              <label htmlFor="dailyCronExpr" className="block text-[10px] font-sans font-bold uppercase tracking-widest">
                Cron expression (UTC)
              </label>
              <input
                type="text"
                id="dailyCronExpr"
                name="cronExpr"
                defaultValue={dailySchedule.cronExpr ?? DEFAULT_DAILY_SCHEDULE_CRON}
                placeholder={DEFAULT_DAILY_SCHEDULE_CRON}
                className="w-full bg-white border border-stone-300 focus:border-ink px-3 py-2 text-xs font-mono"
              />
              <p className="text-[10px] font-sans text-stone-500">
                5-field cron (minute hour day month weekday), e.g.{" "}
                <code className="font-mono">{DEFAULT_DAILY_SCHEDULE_CRON}</code> = every day at 04:00 UTC.
              </p>
            </div>
            {dailySchedule.enabled && dailySchedule.cronExpr && (
              <p className="text-[10px] font-sans text-stone-500">
                {nextDailyRun
                  ? `Next scheduled run: ${nextDailyRun.toUTCString()}`
                  : "Schedule is enabled, but no upcoming run could be computed (check the cron expression)."}
              </p>
            )}
            <button
              type="submit"
              data-loading-text="Saving…"
              className="w-full px-3 py-2 text-xs font-bold uppercase tracking-widest bg-ink text-paper hover:bg-ink-light transition-colors mt-2"
            >
              Save Schedule
            </button>
          </form>
        </div>

        {/* Account — transplanted from the now-deleted /admin/account page. */}
        <div className="border border-stone-200 bg-white p-6">
          <h3 className="text-xs font-sans font-bold uppercase tracking-widest text-stone-600 mb-4">
            Account
          </h3>
          <form method="POST" action="/admin/account/password" className="space-y-3" data-loading-submit>
            <div>
              <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                New Password
              </label>
              <input
                type="password"
                name="password"
                required
                minLength={8}
                className="w-full bg-white border border-stone-300 focus:border-ink px-3 py-2 text-sm font-sans"
              />
            </div>
            <div>
              <label className="block text-[10px] font-sans font-bold uppercase tracking-widest mb-1">
                Confirm New Password
              </label>
              <input
                type="password"
                name="confirm"
                required
                minLength={8}
                className="w-full bg-white border border-stone-300 focus:border-ink px-3 py-2 text-sm font-sans"
              />
            </div>
            <p className="text-[10px] font-serif text-stone-500">
              Other logged-in devices stay signed in — this does not rotate the session-signing secret.
            </p>
            <button
              type="submit"
              data-loading-text="Updating…"
              className="w-full px-3 py-2 text-xs font-bold uppercase tracking-widest bg-ink text-paper hover:bg-ink-light transition-colors"
            >
              Update Password
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-stone-100">
            <h4 className="text-xs font-sans font-bold uppercase tracking-widest text-stone-600 mb-2">
              JSON API Token
            </h4>
            <p className="text-[10px] font-serif text-stone-500 mb-3">
              Bearer token required by <code>POST /api/articles</code>. Regenerating replaces the
              current token — update any client using the old one.
            </p>
            <form
              method="POST"
              action="/admin/account/api-token"
              data-confirm="Regenerate the API token? The current one stops working immediately — any client using it will need the new one."
              data-loading-submit
            >
              <button
                type="submit"
                data-loading-text="Regenerating…"
                className="w-full px-3 py-2 text-xs font-bold uppercase tracking-widest border border-ink hover:bg-stone-100 transition-colors"
              >
                Regenerate API Token
              </button>
            </form>
          </div>
        </div>
      </Section>
    </>
  );
}
