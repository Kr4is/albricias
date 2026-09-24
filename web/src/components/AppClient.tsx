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
  { id: "ollama", label: "Ollama (local)" },
  { id: "litellm", label: "LiteLLM / OpenAI-compatible" },
];

const INPUT_CLASS =
  "w-full border border-stone-300 bg-white px-3 py-2 font-body text-sm focus:outline-none focus:border-ink";
const LABEL_CLASS = "font-sans text-[11px] font-bold uppercase tracking-widest text-stone-600 block mb-1";

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

  const needsModel = llmProvider === "ollama" || llmProvider === "litellm";
  const needsBaseUrl = llmProvider === "ollama" || llmProvider === "litellm";
  const needsKey = llmProvider !== "ollama";

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
            const data = message.data as IssueMeta & { layout: LayoutIndex; warnings: string[] };
            setIssueMeta({ vol: data.vol, dateLabel: data.dateLabel, dateShortLabel: data.dateShortLabel, weather: data.weather });
            setLayout(data.layout);
            setWarnings(data.warnings ?? []);
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
        <div className="mb-6 no-print text-center">
          {finished ? (
            <>
              <button
                onClick={reset}
                className="font-sans text-xs font-bold uppercase tracking-widest text-ink border border-ink px-4 py-2 hover:bg-ink hover:text-white transition-colors"
              >
                ← Generate Another Edition
              </button>
              {warnings.length > 0 && (
                <p className="font-body text-xs text-stone-500 italic mt-3">
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
    <form onSubmit={handleSubmit} className="max-w-lg mx-auto py-12">
      <h1 className="font-headline text-3xl font-bold text-center mb-2">Print Your Edition</h1>
      <p className="font-body text-sm text-stone-600 text-center mb-10">
        Your GitHub activity, set in vintage type.
      </p>

      <div className="flex flex-col gap-5">
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
          <label className={LABEL_CLASS} htmlFor="period">Period</label>
          <select
            id="period"
            className={INPUT_CLASS}
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>

        <div className="border-t border-stone-300 pt-5">
          <label className={LABEL_CLASS} htmlFor="llmProvider">LLM Provider</label>
          <select
            id="llmProvider"
            className={INPUT_CLASS}
            value={llmProvider}
            onChange={(e) => setLlmProvider(e.target.value as AiProviderId)}
          >
            {PROVIDERS.map((provider) => (
              <option key={provider.id} value={provider.id}>{provider.label}</option>
            ))}
          </select>
          <p className="font-body text-xs text-stone-500 mt-1">
            Your API key is used only for this generation and is never stored.
          </p>
        </div>

        {needsKey && (
          <div>
            <label className={LABEL_CLASS} htmlFor="llmApiKey">API Key</label>
            <input
              id="llmApiKey"
              type="password"
              className={INPUT_CLASS}
              value={llmApiKey}
              onChange={(e) => setLlmApiKey(e.target.value)}
              required={needsKey}
            />
          </div>
        )}

        <div>
          <label className={LABEL_CLASS} htmlFor="llmModel">
            Model {needsModel ? "" : "(optional)"}
          </label>
          <input
            id="llmModel"
            className={INPUT_CLASS}
            value={llmModel}
            onChange={(e) => setLlmModel(e.target.value)}
            placeholder={llmProvider === "openai" ? "gpt-4o-mini" : llmProvider === "gemini" ? "gemini-2.0-flash" : "llama3.1"}
            required={needsModel}
          />
        </div>

        {needsBaseUrl && (
          <div>
            <label className={LABEL_CLASS} htmlFor="llmBaseUrl">Base URL</label>
            <input
              id="llmBaseUrl"
              className={INPUT_CLASS}
              value={llmBaseUrl}
              onChange={(e) => setLlmBaseUrl(e.target.value)}
              placeholder={llmProvider === "ollama" ? "http://localhost:11434/v1" : "https://your-litellm-proxy/v1"}
              required={llmProvider === "litellm"}
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
    </form>
  );
}
