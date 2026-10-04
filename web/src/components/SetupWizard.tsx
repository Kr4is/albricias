"use client";

/**
 * The "Print Your Edition" form as four short steps — byline, sources,
 * newsroom (the AI), press — instead of one long list. Every value lives in
 * the parent's `form` (remembered in localStorage by `AppClient`); this only
 * decides what to show and when "Next" may be pressed.
 */

import { useState, type FormEvent } from "react";
import { CADENCES, CADENCE_LABELS, type Cadence } from "@/lib/periods";
import type { AiProviderId, ThinkingMode } from "@/lib/ai/resolve";

export interface SetupForm {
  githubUsername: string;
  period: Cadence;
  /** Also report on the user's private repositories — needs `githubToken`. */
  includePrivate: boolean;
  githubToken: string;
  llmProvider: AiProviderId;
  llmApiKey: string;
  llmModel: string;
  llmBaseUrl: string;
  thinking: ThinkingMode;
}

export const DEFAULT_FORM: SetupForm = {
  githubUsername: "",
  period: "monthly",
  includePrivate: false,
  githubToken: "",
  llmProvider: "openai",
  llmApiKey: "",
  llmModel: "",
  llmBaseUrl: "",
  thinking: "full",
};

export const PROVIDERS: { id: AiProviderId; label: string }[] = [
  { id: "openai", label: "OpenAI" },
  { id: "gemini", label: "Google Gemini" },
  { id: "litellm", label: "LLM Gateway" },
];

/** Where a thinking model behind the gateway may reason — most of its time goes there. */
export const THINKING: { id: ThinkingMode; label: string }[] = [
  { id: "full", label: "Everywhere" },
  { id: "outline", label: "Outline only" },
  { id: "off", label: "Off" },
];

const PERIOD_HINTS: Record<Cadence, string> = {
  weekly: "The last full week",
  monthly: "The last full month",
  quarterly: "The last full quarter",
};

const STEPS = [
  { id: "byline", label: "Byline" },
  { id: "sources", label: "Sources" },
  { id: "newsroom", label: "Newsroom" },
  { id: "press", label: "Press" },
] as const;
type StepId = (typeof STEPS)[number]["id"];

/** Why `step` can't be left yet, or `null` when it's complete. */
export function stepProblem(step: StepId, form: SetupForm): string | null {
  switch (step) {
    case "byline":
      return form.githubUsername.trim() ? null : "Enter a GitHub username.";
    case "sources":
      return form.includePrivate && !form.githubToken.trim() ? "Paste a token to include private activity." : null;
    case "newsroom":
      if (!form.llmApiKey.trim()) return "An API key is needed.";
      if (form.llmProvider === "litellm" && (!form.llmModel.trim() || !form.llmBaseUrl.trim())) return "A gateway needs a model and a base URL.";
      return null;
    case "press":
      return null;
  }
}

/** The first step that isn't complete, or the last one when all are. */
export function firstIncompleteStep(form: SetupForm): number {
  const index = STEPS.findIndex((step) => stepProblem(step.id, form));
  return index === -1 ? STEPS.length - 1 : index;
}

const INPUT_CLASS =
  "w-full border border-stone-300 bg-white px-3 py-2 font-body text-sm focus:outline-none focus:border-ink";
const LABEL_CLASS = "font-sans text-[11px] font-bold uppercase tracking-widest text-stone-600 block mb-1";
const PILL_BASE = "px-4 py-2 font-sans text-xs font-bold uppercase tracking-widest border transition-colors";
const PILL_ACTIVE = "bg-ink text-white border-ink";
const PILL_INACTIVE = "bg-white text-ink border-stone-300 hover:border-ink";
const HINT_CLASS = "font-body text-xs text-stone-500 mt-1";
const FORGET_CLASS = "font-sans text-[10px] uppercase tracking-widest text-stone-400 hover:text-ink mb-1";

function Pills<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="flex gap-2">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={`${PILL_BASE} flex-1 ${value === option.id ? PILL_ACTIVE : PILL_INACTIVE}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export default function SetupWizard({
  form,
  setForm,
  initialStep,
  error,
  onSubmit,
}: {
  form: SetupForm;
  setForm: (patch: Partial<SetupForm>) => void;
  /** Where to open: the last step for a returning visitor whose settings are all saved. */
  initialStep: number;
  error: string | null;
  onSubmit: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(initialStep);
  const step = STEPS[stepIndex].id;
  const problem = stepProblem(step, form);
  const last = stepIndex === STEPS.length - 1;
  const needsGateway = form.llmProvider === "litellm";
  /** A step may be jumped to when every step before it is complete. */
  const reachable = firstIncompleteStep(form);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (problem) return;
    if (last) onSubmit();
    else setStepIndex(stepIndex + 1);
  }

  return (
    <form onSubmit={handleSubmit} className="py-12">
      <h1 className="font-headline text-3xl md:text-4xl font-bold text-center mb-2">Print Your Edition</h1>
      <p className="font-body text-sm text-stone-600 text-center mb-12">Your GitHub activity, set in vintage type.</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        <div className="flex flex-col justify-center gap-8 lg:border-r lg:border-stone-300 lg:pr-12">
          <div>
            <span className="font-sans text-[10px] font-bold uppercase tracking-widest text-stone-500">Notice</span>
            <h2 className="font-headline text-2xl font-bold mt-1 mb-3">What Happens Next</h2>
            <p className="font-body text-sm text-stone-600 leading-relaxed max-w-md">
              We fetch <strong>{form.githubUsername || "your"}</strong>&apos;s{" "}
              {form.includePrivate ? "public and private" : "public"} GitHub activity for the{" "}
              {PERIOD_HINTS[form.period].toLowerCase()}, hand it to your chosen AI, and set it in type — live, on this
              page. Your choices below are saved in this browser for next time — your API key and GitHub token
              included, never written to a server-side database or log.
            </p>
          </div>
          <div className="border-t border-stone-300 pt-6">
            <span className="font-sans text-[10px] font-bold uppercase tracking-widest text-stone-500">This Edition</span>
            <p className="font-headline text-2xl mt-2">
              {form.githubUsername ? `${form.githubUsername}'s ${form.period} edition` : "Awaiting a byline…"}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-6 max-w-md">
          <ol className="flex gap-1.5" aria-label="Steps">
            {STEPS.map((s, i) => (
              <li key={s.id} className="flex-1">
                <button
                  type="button"
                  disabled={i > reachable}
                  onClick={() => setStepIndex(i)}
                  aria-current={i === stepIndex ? "step" : undefined}
                  className={`w-full px-1 py-2 font-sans text-[10px] font-bold uppercase tracking-widest border transition-colors disabled:opacity-40 disabled:pointer-events-none ${
                    i === stepIndex ? PILL_ACTIVE : PILL_INACTIVE
                  }`}
                >
                  {i + 1}. {s.label}
                </button>
              </li>
            ))}
          </ol>

          {step === "byline" && (
            <>
              <div>
                <label className={LABEL_CLASS} htmlFor="githubUsername">GitHub Username</label>
                <input
                  id="githubUsername"
                  className={INPUT_CLASS}
                  value={form.githubUsername}
                  onChange={(e) => setForm({ githubUsername: e.target.value })}
                  placeholder="octocat"
                  autoFocus
                />
              </div>
              <div>
                <span className={LABEL_CLASS}>Period</span>
                <Pills
                  options={CADENCES.map((id) => ({ id, label: CADENCE_LABELS[id] }))}
                  value={form.period}
                  onChange={(period) => setForm({ period })}
                />
                <p className={HINT_CLASS}>{PERIOD_HINTS[form.period]} — a finished period, so there&apos;s always plenty to report.</p>
              </div>
            </>
          )}

          {step === "sources" && (
            <>
              <div className="flex flex-col gap-2">
                <span className={LABEL_CLASS}>What to report on</span>
                <button
                  type="button"
                  onClick={() => setForm({ includePrivate: false })}
                  className={`${PILL_BASE} text-left normal-case tracking-normal ${!form.includePrivate ? PILL_ACTIVE : PILL_INACTIVE}`}
                >
                  <span className="block font-bold uppercase tracking-widest">Public activity only</span>
                  <span className="block font-body text-xs font-normal mt-1 opacity-80">
                    Nothing to paste: only what anyone can already see on GitHub.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setForm({ includePrivate: true })}
                  className={`${PILL_BASE} text-left normal-case tracking-normal ${form.includePrivate ? PILL_ACTIVE : PILL_INACTIVE}`}
                >
                  <span className="block font-bold uppercase tracking-widest">Include my private activity</span>
                  <span className="block font-body text-xs font-normal mt-1 opacity-80">
                    Also reads your private repositories, with a token of your own.
                  </span>
                </button>
              </div>

              {form.includePrivate && (
                <div>
                  <div className="flex items-baseline justify-between">
                    <label className={LABEL_CLASS} htmlFor="githubToken">GitHub Token</label>
                    {form.githubToken && (
                      <button type="button" onClick={() => setForm({ githubToken: "" })} className={FORGET_CLASS}>
                        Forget token
                      </button>
                    )}
                  </div>
                  <input
                    id="githubToken"
                    name="githubToken"
                    type="password"
                    autoComplete="current-password"
                    className={INPUT_CLASS}
                    value={form.githubToken}
                    onChange={(e) => setForm({ githubToken: e.target.value })}
                    placeholder="ghp_… or github_pat_…"
                  />
                  <p className={HINT_CLASS}>
                    Read-only is enough: a classic token with the <code>repo</code> scope, or a fine-grained one with
                    read access to your repositories&apos; contents, issues and pull requests. It must belong to{" "}
                    <strong>{form.githubUsername || "your account"}</strong>. Saved in this browser only.
                  </p>
                  <p className={HINT_CLASS}>
                    Private repository names and commit messages go to your AI provider and appear on the page — share
                    the result accordingly.
                  </p>
                </div>
              )}
            </>
          )}

          {step === "newsroom" && (
            <>
              <div>
                <span className={LABEL_CLASS}>LLM Provider</span>
                <Pills options={PROVIDERS} value={form.llmProvider} onChange={(llmProvider) => setForm({ llmProvider })} />
              </div>

              <div>
                <div className="flex items-baseline justify-between">
                  <label className={LABEL_CLASS} htmlFor="llmApiKey">API Key</label>
                  {form.llmApiKey && (
                    <button type="button" onClick={() => setForm({ llmApiKey: "" })} className={FORGET_CLASS}>
                      Forget key
                    </button>
                  )}
                </div>
                <input
                  id="llmApiKey"
                  name="llmApiKey"
                  type="password"
                  autoComplete="current-password"
                  className={INPUT_CLASS}
                  value={form.llmApiKey}
                  onChange={(e) => setForm({ llmApiKey: e.target.value })}
                />
                <p className={HINT_CLASS}>
                  Saved in this browser only, like any other password — never written to a server-side database or log.
                </p>
              </div>

              <div>
                <label className={LABEL_CLASS} htmlFor="llmModel">Model {needsGateway ? "" : "(optional)"}</label>
                <input
                  id="llmModel"
                  className={INPUT_CLASS}
                  value={form.llmModel}
                  onChange={(e) => setForm({ llmModel: e.target.value })}
                  placeholder={form.llmProvider === "openai" ? "gpt-4o-mini" : form.llmProvider === "gemini" ? "gemini-2.0-flash" : "llama3.1"}
                />
              </div>

              {needsGateway && (
                <>
                  <div>
                    <label className={LABEL_CLASS} htmlFor="llmBaseUrl">Base URL</label>
                    <input
                      id="llmBaseUrl"
                      className={INPUT_CLASS}
                      value={form.llmBaseUrl}
                      onChange={(e) => setForm({ llmBaseUrl: e.target.value })}
                      placeholder="https://your-llm-gateway/v1"
                    />
                  </div>
                  <div>
                    <span className={LABEL_CLASS}>Thinking</span>
                    <Pills options={THINKING} value={form.thinking} onChange={(thinking) => setForm({ thinking })} />
                    <p className={HINT_CLASS}>
                      For thinking models (Qwen and the like, on vLLM or SGLang): where they may reason before writing.
                      Reasoning is most of their time — &ldquo;Outline only&rdquo; plans carefully and writes fast.
                    </p>
                  </div>
                </>
              )}
            </>
          )}

          {step === "press" && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-y border-stone-300 py-4 font-body text-sm">
              <dt className={LABEL_CLASS}>Byline</dt>
              <dd>{form.githubUsername}</dd>
              <dt className={LABEL_CLASS}>Period</dt>
              <dd>{PERIOD_HINTS[form.period]}</dd>
              <dt className={LABEL_CLASS}>Sources</dt>
              <dd>{form.includePrivate ? "Public and private activity" : "Public activity only"}</dd>
              <dt className={LABEL_CLASS}>AI</dt>
              <dd>
                {PROVIDERS.find((p) => p.id === form.llmProvider)?.label}
                {form.llmModel ? ` · ${form.llmModel}` : ""}
              </dd>
            </dl>
          )}

          {error && <p className="font-body text-sm text-red-800">{error}</p>}
          {problem && !last && <p className="font-body text-xs text-stone-500 italic">{problem}</p>}

          <div className="flex gap-2 mt-2">
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={() => setStepIndex(stepIndex - 1)}
                className="font-sans text-sm font-bold uppercase tracking-widest text-ink border border-ink px-6 py-3 hover:bg-ink hover:text-white transition-colors"
              >
                Back
              </button>
            )}
            <button
              type="submit"
              disabled={problem !== null}
              className="flex-1 font-sans text-sm font-bold uppercase tracking-widest text-white bg-ink px-6 py-3 hover:opacity-85 transition-opacity disabled:opacity-40 disabled:pointer-events-none"
            >
              {last ? "Print My Edition" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
