"use client";

import { useState, type FormEvent } from "react";
import IssueLayout from "@/components/issue/IssueLayout";
import GeneratingAnimation from "@/components/GeneratingAnimation";
import type { IssueArticle } from "@/components/issue/types";
import type { LayoutIndex } from "@/lib/layout";
import type { AiProviderId } from "@/lib/ai/resolve";

type Period = "daily" | "weekly" | "monthly";
type Phase = "config" | "generating" | "result";

interface IssueMeta {
  vol: string;
  dateLabel: string;
  dateShortLabel: string;
  weather: string;
}

const PROVIDERS: { id: AiProviderId; label: string }[] = [
  { id: "openai", label: "OpenAI" },
  { id: "gemini", label: "Google Gemini" },
  { id: "litellm", label: "LLM Gateway" },
];

const PERIODS: { id: Period; label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
];

/** One label per `IssueV*`, from each file's own one-line self-description. */
const LAYOUT_OPTIONS: { id: LayoutIndex; label: string }[] = [
  { id: 1, label: "3-Column" },
  { id: 2, label: "Dispatches" },
  { id: 3, label: "Hero" },
  { id: 4, label: "Asymmetric" },
  { id: 5, label: "Editorial" },
  { id: 6, label: "Broadside" },
];

const INPUT_CLASS =
  "w-full border border-stone-300 bg-white px-3 py-2 font-body text-sm focus:outline-none focus:border-ink";
const LABEL_CLASS = "font-sans text-[11px] font-bold uppercase tracking-widest text-stone-600 block mb-1";
const PILL_BASE =
  "px-4 py-2 font-sans text-xs font-bold uppercase tracking-widest border transition-colors";
const PILL_ACTIVE = "bg-ink text-white border-ink";
const PILL_INACTIVE = "bg-white text-ink border-stone-300 hover:border-ink";

/** One `event: ...\ndata: ...` block, as `/api/generate` writes it (`sseEvent()` in the route). */
function parseSseMessage(raw: string): { event: string; data: unknown } | null {
  let event = "message";
  let dataLine = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    else if (line.startsWith("data:")) dataLine += line.slice("data:".length).trim();
  }
  if (!dataLine) return null;
  try {
    return { event, data: JSON.parse(dataLine) };
  } catch {
    return null;
  }
}

export default function AppClient() {
  const [phase, setPhase] = useState<Phase>("config");
  const [statusMessage, setStatusMessage] = useState("Fetching your activity…");
  const [issueMeta, setIssueMeta] = useState<IssueMeta | null>(null);
  const [layout, setLayout] = useState<LayoutIndex | null>(null);
  const [title, setTitle] = useState("");
  const [articles, setArticles] = useState<IssueArticle[]>([]);
  const [streamingId, setStreamingId] = useState<number | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [githubUsername, setGithubUsername] = useState("");
  const [period, setPeriod] = useState<Period>("weekly");
  const [llmProvider, setLlmProvider] = useState<AiProviderId>("openai");
  const [llmApiKey, setLlmApiKey] = useState("");
  const [llmModel, setLlmModel] = useState("");
  const [llmBaseUrl, setLlmBaseUrl] = useState("");

  const needsGateway = llmProvider === "litellm";

  function reset() {
    setPhase("config");
    setStatusMessage("Fetching your activity…");
    setIssueMeta(null);
    setLayout(null);
    setTitle("");
    setArticles([]);
    setStreamingId(null);
    setWarnings([]);
    setFinished(false);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    reset();
    setPhase("generating");

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          githubUsername,
          period,
          llmProvider,
          llmApiKey: llmApiKey || undefined,
          llmModel: llmModel || undefined,
          llmBaseUrl: llmBaseUrl || undefined,
        }),
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || `Request failed (${response.status}).`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let sawFirstSection = false;
      let streamError: string | null = null;
      let sawDone = false;

      for (;;) {
        const { value, done: readerDone } = await reader.read();
        if (readerDone) break;
        buffer += decoder.decode(value, { stream: true });

        let separatorIndex: number;
        while ((separatorIndex = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);
          const message = parseSseMessage(raw);
          if (!message) continue;

          if (message.event === "meta") {
            const data = message.data as IssueMeta & { warnings: string[] };
            setIssueMeta({ vol: data.vol, dateLabel: data.dateLabel, dateShortLabel: data.dateShortLabel, weather: data.weather });
            setWarnings(data.warnings ?? []);
          } else if (message.event === "layout") {
            setLayout((message.data as { layout: LayoutIndex }).layout);
          } else if (message.event === "status") {
            setStatusMessage((message.data as { message: string }).message);
          } else if (message.event === "section-start") {
            const data = message.data as { index: number; heading: string; category: string; author: string | null; deck: string };
            setArticles((prev) => [
              ...prev,
              { id: data.index, title: data.heading, content: "", category: data.category, author: data.author, deck: data.deck },
            ]);
            setStreamingId(data.index);
            if (!sawFirstSection) {
              sawFirstSection = true;
              setPhase("result");
            }
          } else if (message.event === "section-delta") {
            const data = message.data as { index: number; delta: string };
            setArticles((prev) => prev.map((a) => (a.id === data.index ? { ...a, content: a.content + data.delta } : a)));
          } else if (message.event === "section-end") {
            const data = message.data as { index: number; failed?: boolean };
            setStreamingId((current) => (current === data.index ? null : current));
            if (data.failed) setArticles((prev) => prev.filter((a) => a.id !== data.index));
          } else if (message.event === "done") {
            setTitle((message.data as { title: string }).title);
            sawDone = true;
          } else if (message.event === "error") {
            streamError = (message.data as { error: string }).error;
          }
        }
      }

      if (streamError) throw new Error(streamError);
      if (!sawDone) throw new Error("The connection ended before generation finished.");
      setFinished(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      reset();
    }
  }

  if (phase === "generating") return <GeneratingAnimation message={statusMessage} />;

  if (phase === "result" && issueMeta && layout) {
    return (
      <div>
        <div className="mb-6 no-print flex flex-col items-center gap-4">
          {finished ? (
            <>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  onClick={reset}
                  className="font-sans text-xs font-bold uppercase tracking-widest text-ink border border-ink px-4 py-2 hover:bg-ink hover:text-white transition-colors"
                >
                  ← Generate Another Edition
                </button>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                <span className="font-sans text-[10px] font-bold uppercase tracking-widest text-stone-400 mr-1">
                  Layout
                </span>
                {LAYOUT_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setLayout(option.id)}
                    className={`px-3 py-1.5 font-sans text-[10px] font-bold uppercase tracking-widest border transition-colors ${
                      layout === option.id ? PILL_ACTIVE : PILL_INACTIVE
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {warnings.length > 0 && (
                <p className="font-body text-xs text-stone-500 italic text-center">
                  Some activity couldn&apos;t be fetched: {warnings.join(" ")}
                </p>
              )}
            </>
          ) : (
            <p className="font-sans text-xs font-bold uppercase tracking-widest text-stone-500 animate-pulse">
              {statusMessage}
            </p>
          )}
        </div>
        <IssueLayout
          layout={layout}
          issue={{ id: 0, title, status: "published", coverImage: null, ...issueMeta }}
          articles={articles}
          streamingArticleId={streamingId}
        />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="py-12">
      <h1 className="font-headline text-3xl md:text-4xl font-bold text-center mb-2">Print Your Edition</h1>
      <p className="font-body text-sm text-stone-600 text-center mb-12">
        Your GitHub activity, set in vintage type.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 max-w-5xl mx-auto">
        <div className="flex flex-col justify-center gap-8 lg:border-r lg:border-stone-300 lg:pr-12">
          <div>
            <span className="font-sans text-[10px] font-bold uppercase tracking-widest text-stone-500">Notice</span>
            <h2 className="font-headline text-2xl font-bold mt-1 mb-3">What Happens Next</h2>
            <p className="font-body text-sm text-stone-600 leading-relaxed">
              We fetch <strong>{githubUsername || "your"}</strong>&apos;s public GitHub
              activity for the {period} period, hand it to your chosen AI, and
              set it in type — live, on this page. Your API key is used only
              for this one request and is never stored.
            </p>
          </div>
          <div className="border-t border-stone-300 pt-6">
            <span className="font-sans text-[10px] font-bold uppercase tracking-widest text-stone-500">This Edition</span>
            <p className="font-headline text-2xl mt-2">
              {githubUsername ? `${githubUsername}'s ${period} edition` : "Awaiting a byline…"}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-6 max-w-md">
          <div>
            <label className={LABEL_CLASS} htmlFor="githubUsername">GitHub Username</label>
            <input
              id="githubUsername"
              className={INPUT_CLASS}
              value={githubUsername}
              onChange={(e) => setGithubUsername(e.target.value)}
              placeholder="octocat"
              required
            />
          </div>

          <div>
            <span className={LABEL_CLASS}>Period</span>
            <div className="flex gap-2">
              {PERIODS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setPeriod(option.id)}
                  className={`${PILL_BASE} flex-1 ${period === option.id ? PILL_ACTIVE : PILL_INACTIVE}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-stone-300 pt-6">
            <span className={LABEL_CLASS}>LLM Provider</span>
            <div className="flex gap-2 mb-2">
              {PROVIDERS.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => setLlmProvider(provider.id)}
                  className={`${PILL_BASE} flex-1 ${llmProvider === provider.id ? PILL_ACTIVE : PILL_INACTIVE}`}
                >
                  {provider.label}
                </button>
              ))}
            </div>
            <p className="font-body text-xs text-stone-500">
              Your API key is used only for this generation and is never stored.
            </p>
          </div>

          <div>
            <label className={LABEL_CLASS} htmlFor="llmApiKey">API Key</label>
            <input
              id="llmApiKey"
              type="password"
              className={INPUT_CLASS}
              value={llmApiKey}
              onChange={(e) => setLlmApiKey(e.target.value)}
              required
            />
          </div>

          <div>
            <label className={LABEL_CLASS} htmlFor="llmModel">
              Model {needsGateway ? "" : "(optional)"}
            </label>
            <input
              id="llmModel"
              className={INPUT_CLASS}
              value={llmModel}
              onChange={(e) => setLlmModel(e.target.value)}
              placeholder={llmProvider === "openai" ? "gpt-4o-mini" : llmProvider === "gemini" ? "gemini-2.0-flash" : "llama3.1"}
              required={needsGateway}
            />
          </div>

          {needsGateway && (
            <div>
              <label className={LABEL_CLASS} htmlFor="llmBaseUrl">Base URL</label>
              <input
                id="llmBaseUrl"
                className={INPUT_CLASS}
                value={llmBaseUrl}
                onChange={(e) => setLlmBaseUrl(e.target.value)}
                placeholder="https://your-llm-gateway/v1"
                required
              />
            </div>
          )}

          {error && <p className="font-body text-sm text-red-800">{error}</p>}

          <button
            type="submit"
            className="font-sans text-sm font-bold uppercase tracking-widest text-white bg-ink px-6 py-3 hover:opacity-85 transition-opacity mt-2"
          >
            Print My Edition
          </button>
        </div>
      </div>
    </form>
  );
}
