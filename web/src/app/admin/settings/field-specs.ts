/**
 * Per-category field lists shared by `/admin/settings`'s forms (`page.tsx` +
 * `./<category>/route.ts`) and the `/setup` onboarding wizard's steps
 * (`src/app/setup/`) — see `.omc/plans/settings-single-path-onboarding.md`'s
 * Step 2. Both surfaces read/save the exact same fields via the exact same
 * `saveFields()` call; only the surrounding form chrome (single "Save" button
 * vs. "Save & Continue"/"Skip"/"Finish setup") differs between them.
 *
 * `SETTINGS_CATEGORIES`' order is also the wizard's step order (Step 0, the
 * mandatory admin password, isn't a category and lives entirely in
 * `src/app/setup/`).
 */

import type { FieldSpec } from "./save-fields";

export interface SettingFieldSpec extends FieldSpec {
  label: string;
  /** Rendered as a masked password input; never round-trips a decrypted value. Defaults `encrypted` to true when unset. */
  secret?: boolean;
  placeholder?: string;
  /** Used as `settingDisplay()`'s fallback when no DB row exists. */
  default?: string;
  /**
   * `"select"` renders a `<select>`. `"provider-picker"` renders the AI
   * step's segmented-button chooser (`AiProviderFields`) instead of a
   * dropdown, and every other field in the same category that declares a
   * matching `providerGroup` is shown only while that option is active.
   * Defaults to `"text"`.
   */
  type?: "text" | "select" | "provider-picker";
  /** Required when `type` is `"select"` or `"provider-picker"`. */
  options?: { value: string; label: string }[];
  /**
   * Ties a field to one `"provider-picker"` option's value — only shown
   * (and only submitted) while that option is selected. Unset on fields not
   * gated by a picker.
   */
  providerGroup?: string;
}

export interface SettingsCategory {
  /** Also the route-folder name (`/admin/settings/<id>`) and the wizard step id. */
  id: string;
  title: string;
  description?: string;
  fields: SettingFieldSpec[];
}

const BRANDING_FIELDS: SettingFieldSpec[] = [
  { formKey: "newspaperName", settingKey: "branding.newspaperName", label: "Newspaper Name", default: "¡Albricias!" },
  {
    formKey: "tagline",
    settingKey: "branding.tagline",
    label: "Tagline",
    default: "All the News That's Fit to Print",
  },
  { formKey: "price", settingKey: "branding.price", label: "Price", default: "Two Cents" },
  { formKey: "metadataRight", settingKey: "branding.metadataRight", label: "Metadata (top-right)" },
];

/**
 * Order here is also the segmented-button order in `AiProviderFields` — the
 * first option (LiteLLM) is the default for a fresh instance, since it's the
 * one most likely to already be free to call (a local/self-hosted proxy).
 */
const AI_FIELDS: SettingFieldSpec[] = [
  {
    formKey: "provider",
    settingKey: "ai.provider",
    label: "Active Provider",
    type: "provider-picker",
    default: "litellm",
    options: [
      { value: "litellm", label: "LiteLLM" },
      { value: "openai", label: "OpenAI" },
      { value: "ollama", label: "Ollama" },
      { value: "gemini", label: "Gemini" },
    ],
  },
  {
    formKey: "litellmBaseUrl",
    settingKey: "integrations.litellm.baseUrl",
    label: "LiteLLM Base URL",
    placeholder: "e.g. https://your-litellm-proxy/v1",
    providerGroup: "litellm",
  },
  {
    formKey: "litellmApiKey",
    settingKey: "integrations.litellm.apiKey",
    label: "LiteLLM API Key",
    secret: true,
    encrypted: true,
    providerGroup: "litellm",
  },
  {
    formKey: "litellmModel",
    settingKey: "integrations.litellm.model",
    label: "LiteLLM Model",
    placeholder: "e.g. qwen2.5-27b",
    providerGroup: "litellm",
  },
  {
    formKey: "openaiApiKey",
    settingKey: "integrations.openai.apiKey",
    label: "OpenAI API Key",
    secret: true,
    encrypted: true,
    providerGroup: "openai",
  },
  {
    formKey: "openaiModel",
    settingKey: "integrations.openai.model",
    label: "OpenAI Model",
    placeholder: "gpt-4o-mini",
    default: "gpt-4o-mini",
    providerGroup: "openai",
  },
  {
    formKey: "ollamaBaseUrl",
    settingKey: "integrations.ollama.baseUrl",
    label: "Ollama Base URL",
    placeholder: "http://localhost:11434/v1",
    default: "http://localhost:11434/v1",
    providerGroup: "ollama",
  },
  {
    formKey: "ollamaModel",
    settingKey: "integrations.ollama.model",
    label: "Ollama Model",
    placeholder: "e.g. llama3.1 (must already be pulled — `ollama pull llama3.1`)",
    providerGroup: "ollama",
  },
  {
    formKey: "geminiApiKey",
    settingKey: "integrations.gemini.apiKey",
    label: "Gemini API Key",
    secret: true,
    encrypted: true,
    providerGroup: "gemini",
  },
  {
    formKey: "geminiModel",
    settingKey: "integrations.gemini.model",
    label: "Gemini Model",
    placeholder: "gemini-2.0-flash",
    default: "gemini-2.0-flash",
    providerGroup: "gemini",
  },
];

const GITHUB_FIELDS: SettingFieldSpec[] = [
  {
    formKey: "token",
    settingKey: "integrations.github.token",
    label: "Personal Access Token",
    secret: true,
    encrypted: true,
  },
  { formKey: "username", settingKey: "integrations.github.username", label: "Username" },
];

const BLOG_FIELDS: SettingFieldSpec[] = [
  {
    formKey: "rssUrl",
    settingKey: "integrations.blog.rssUrl",
    label: "Feed URL",
    placeholder: "https://example.com/feed.xml",
  },
];

const EMAIL_FIELDS: SettingFieldSpec[] = [
  { formKey: "smtpHost", settingKey: "email.smtpHost", label: "SMTP Host" },
  { formKey: "smtpPort", settingKey: "email.smtpPort", label: "SMTP Port", placeholder: "587" },
  { formKey: "smtpUser", settingKey: "email.smtpUser", label: "SMTP User" },
  {
    formKey: "smtpPass",
    settingKey: "email.smtpPass",
    label: "SMTP Password",
    secret: true,
    encrypted: true,
  },
  { formKey: "fromAddress", settingKey: "email.fromAddress", label: "From Address" },
  {
    formKey: "siteUrl",
    settingKey: "site.url",
    label: "Site URL",
    placeholder: "http://localhost:3000",
    default: "http://localhost:3000",
  },
];

const SPOTIFY_FIELDS: SettingFieldSpec[] = [
  { formKey: "clientId", settingKey: "integrations.spotify.clientId", label: "Client ID" },
  {
    formKey: "clientSecret",
    settingKey: "integrations.spotify.clientSecret",
    label: "Client Secret",
    secret: true,
    encrypted: true,
  },
  {
    formKey: "redirectUri",
    settingKey: "integrations.spotify.redirectUri",
    label: "Redirect URI",
    default: "http://localhost:3000/admin/spotify/callback",
  },
];

const TWITTER_FIELDS: SettingFieldSpec[] = [
  { formKey: "clientId", settingKey: "integrations.twitter.clientId", label: "Client ID" },
  {
    formKey: "clientSecret",
    settingKey: "integrations.twitter.clientSecret",
    label: "Client Secret",
    secret: true,
    encrypted: true,
  },
  {
    formKey: "redirectUri",
    settingKey: "integrations.twitter.redirectUri",
    label: "Redirect URI",
    default: "http://localhost:3000/admin/social/twitter/callback",
  },
];

const GOOGLE_FIELDS: SettingFieldSpec[] = [
  { formKey: "clientId", settingKey: "integrations.google.clientId", label: "Client ID" },
  {
    formKey: "clientSecret",
    settingKey: "integrations.google.clientSecret",
    label: "Client Secret",
    secret: true,
    encrypted: true,
  },
  {
    formKey: "redirectUri",
    settingKey: "integrations.google.redirectUri",
    label: "Redirect URI",
    default: "http://localhost:3000/admin/calendar/callback",
  },
];

const ALEXANDRIA_FIELDS: SettingFieldSpec[] = [
  {
    formKey: "apiUrl",
    settingKey: "integrations.alexandria.apiUrl",
    label: "API URL",
    placeholder: "https://alexandria.example.com",
  },
  {
    formKey: "apiToken",
    settingKey: "integrations.alexandria.apiToken",
    label: "API Token (optional)",
    secret: true,
    encrypted: true,
  },
];

/** Order here is also the onboarding wizard's step order (after Step 0). */
export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  { id: "branding", title: "Branding", fields: BRANDING_FIELDS },
  {
    id: "ai",
    title: "AI",
    description:
      "Powers article generation, activity/calendar rankings, and social copy. Choose one active " +
      "provider below; only its fields need to be filled in. (TTS narration is a separate, " +
      "OpenAI-only feature and always uses the OpenAI key regardless of this choice.)",
    fields: AI_FIELDS,
  },
  {
    id: "github",
    title: "GitHub",
    description:
      "Fetches your activity for the automatic edition-generation pipeline. The token needs the " +
      "repo scope (private commits/PRs/issues/releases) and the gist scope (gists) — a public-only " +
      "token still works, but under-reports anything in private repos.",
    fields: GITHUB_FIELDS,
  },
  { id: "blog", title: "Blog", description: "RSS feed used as an activity source.", fields: BLOG_FIELDS },
  {
    id: "email",
    title: "Email / Newsletter",
    description: "Self-hosted SMTP send — no SaaS newsletter provider.",
    fields: EMAIL_FIELDS,
  },
  {
    id: "spotify",
    title: "Spotify",
    description: "OAuth app credentials — entering these makes the Connect button on the dashboard work.",
    fields: SPOTIFY_FIELDS,
  },
  {
    id: "twitter",
    title: "X (Twitter)",
    description: "OAuth app credentials for the Connect button on /admin/social.",
    fields: TWITTER_FIELDS,
  },
  {
    id: "google",
    title: "Google Calendar",
    description: "OAuth app credentials for the Connect button on /admin/calendar.",
    fields: GOOGLE_FIELDS,
  },
  {
    id: "alexandria",
    title: "Alexandria",
    description: "Personal reading library — feeds the Bookshelf column. Unset skips it gracefully.",
    fields: ALEXANDRIA_FIELDS,
  },
];

export function findCategory(id: string): SettingsCategory | undefined {
  return SETTINGS_CATEGORIES.find((category) => category.id === id);
}

/**
 * The `/setup` wizard's own step order — a curated subset of
 * `SETTINGS_CATEGORIES`, independent of that array's full order/length.
 * `/admin/settings` still shows every category regardless of this list; this
 * is only what a first run is walked through. Grow it as more integrations
 * are wizard-ready — GitHub and AI are the only two worth asking about on
 * day one right now.
 */
const ONBOARDING_CATEGORY_IDS = ["github", "ai"];

export const ONBOARDING_CATEGORIES: SettingsCategory[] = ONBOARDING_CATEGORY_IDS.map(
  (id) => findCategory(id)!,
);
