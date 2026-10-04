"use client";

import { useEffect, useRef, useState } from "react";
import IssueLayout from "@/components/issue/IssueLayout";
import GeneratingAnimation from "@/components/GeneratingAnimation";
import ExportActions from "@/components/ExportActions";
import { usePageFill } from "@/components/usePageFill";
import type { IssueArticle } from "@/components/issue/types";
import type { LayoutIndex } from "@/lib/layout";
import type { ArticleBlock, ArticleImageRef } from "@/lib/article-blocks";
import { CADENCES } from "@/lib/periods";
import SetupWizard, { DEFAULT_FORM, PROVIDERS, THINKING, firstIncompleteStep, type SetupForm } from "@/components/SetupWizard";

type Phase = "config" | "generating" | "result";

interface IssueMeta {
  vol: string;
  dateLabel: string;
  weather: string;
}

/** One label per `IssueV*`, from each file's own one-line self-description. */
const LAYOUT_OPTIONS: { id: LayoutIndex; label: string }[] = [
  { id: 1, label: "Banner" },
  { id: 2, label: "Dispatches" },
  { id: 3, label: "Hero" },
  { id: 4, label: "Lead & Briefs" },
  { id: 5, label: "Editorial" },
  { id: 6, label: "Extra" },
];

/**
 * The whole setup form, remembered across visits, including the API key — by explicit request:
 * treated like a saved password, not silently. Stored only in this
 * browser's localStorage, never sent anywhere but `/api/generate`; the
 * `autoComplete="current-password"` on the key field also lets the
 * browser's own password manager offer to save/fill it independently.
 */
const STORAGE_KEY = "albricias:generate-form";

const PILL_ACTIVE = "bg-ink text-white border-ink";
const PILL_INACTIVE = "bg-white text-ink border-stone-300 hover:border-ink";

/**
 * Where an article sits on the page: written sections by their outline
 * index (they can start out of order when several are written at once —
 * the first is always the lead), then the computed boxes, whose ids are
 * negative (-1 stars, -2 numbers).
 */
function readingOrder(id: number): number {
  return id >= 0 ? id : 1_000_000 - id;
}

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
  const [layoutPickedByHand, setLayoutPickedByHand] = useState(false);
  const [fold, setFold] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [articles, setArticles] = useState<IssueArticle[]>([]);
  const [streamingIds, setStreamingIds] = useState<ReadonlySet<number>>(new Set());
  const [warnings, setWarnings] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setFormState] = useState<SetupForm>(DEFAULT_FORM);
  const setForm = (patch: Partial<SetupForm>) => setFormState((prev) => ({ ...prev, ...patch }));

  // Load once on mount — after render, so a saved value never fights the
  // server-rendered default during hydration (a lazy useState initializer
  // would read localStorage during the client's hydration pass too, which
  // mismatches the server-rendered markup). The wizard only mounts once
  // `loaded`, so it opens on the right step for what was saved.
  //
  // `loaded` also gates the save effect below until this one has run: both
  // effects fire in the same pass on mount, and the save effect's closure
  // still has the *pre-load* defaults — it would overwrite what this effect
  // just read before the loaded values ever reach the screen.
  const [loaded, setLoaded] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<SetupForm>;
        // Each value is checked, so a form saved by an older version (a
        // removed period, say) falls back to the default instead of breaking.
        const patch: Partial<SetupForm> = {};
        if (typeof saved.githubUsername === "string") patch.githubUsername = saved.githubUsername;
        if (typeof saved.githubToken === "string") patch.githubToken = saved.githubToken;
        if (saved.includePrivate === true) patch.includePrivate = true;
        if (saved.period && CADENCES.includes(saved.period)) patch.period = saved.period;
        if (saved.llmProvider && PROVIDERS.some((p) => p.id === saved.llmProvider)) patch.llmProvider = saved.llmProvider;
        if (typeof saved.llmApiKey === "string") patch.llmApiKey = saved.llmApiKey;
        if (typeof saved.llmModel === "string") patch.llmModel = saved.llmModel;
        if (typeof saved.llmBaseUrl === "string") patch.llmBaseUrl = saved.llmBaseUrl;
        if (saved.thinking && THINKING.some((t) => t.id === saved.thinking)) patch.thinking = saved.thinking;
        setFormState((prev) => ({ ...prev, ...patch }));
      }
    } catch {
      // Private browsing, blocked storage, malformed JSON — just start blank.
    }
    setLoaded(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
    } catch {
      // Storage unavailable — the form still works, it just won't be remembered.
    }
  }, [loaded, form]);

  const pageRef = useRef<HTMLDivElement>(null);
  usePageFill({
    ref: pageRef,
    active: phase === "result" && finished,
    layout,
    total: articles.length,
    allowRepick: !layoutPickedByHand,
    onRepick: setLayout,
    onFold: setFold,
  });

  function reset() {
    setPhase("config");
    setStatusMessage("Fetching your activity…");
    setIssueMeta(null);
    setLayout(null);
    setLayoutPickedByHand(false);
    setFold(null);
    setTitle("");
    setArticles([]);
    setStreamingIds(new Set());
    setWarnings([]);
    setFinished(false);
  }

  async function handleSubmit() {
    setError(null);
    reset();
    setPhase("generating");

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          githubUsername: form.githubUsername.trim(),
          period: form.period,
          includePrivate: form.includePrivate,
          githubToken: form.includePrivate ? form.githubToken.trim() : undefined,
          llmProvider: form.llmProvider,
          llmApiKey: form.llmApiKey.trim(),
          llmModel: form.llmModel.trim() || undefined,
          llmBaseUrl: form.llmBaseUrl.trim() || undefined,
          thinking: form.llmProvider === "litellm" ? form.thinking : undefined,
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
            setIssueMeta({ vol: data.vol, dateLabel: data.dateLabel, weather: data.weather });
            setWarnings(data.warnings ?? []);
          } else if (message.event === "layout") {
            setLayout((message.data as { layout: LayoutIndex }).layout);
          } else if (message.event === "status") {
            setStatusMessage((message.data as { message: string }).message);
          } else if (message.event === "section-start") {
            const data = message.data as { index: number; heading: string; category: string; author: string | null; deck: string; image?: ArticleImageRef | null; blocks?: ArticleBlock[] };
            setArticles((prev) =>
              [
                ...prev,
                { id: data.index, title: data.heading, content: "", category: data.category, author: data.author, deck: data.deck, image: data.image ?? null, blocks: data.blocks ?? [] },
              ].sort((a, b) => readingOrder(a.id) - readingOrder(b.id)),
            );
            setStreamingIds((prev) => new Set(prev).add(data.index));
            if (!sawFirstSection) {
              sawFirstSection = true;
              setPhase("result");
            }
          } else if (message.event === "section-delta") {
            const data = message.data as { index: number; delta: string };
            setArticles((prev) => prev.map((a) => (a.id === data.index ? { ...a, content: a.content + data.delta } : a)));
          } else if (message.event === "section-end") {
            const data = message.data as { index: number; failed?: boolean };
            setStreamingIds((prev) => {
              const next = new Set(prev);
              next.delete(data.index);
              return next;
            });
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
              <ExportActions
                targetRef={pageRef}
                filename={`albricias-${form.githubUsername.replace(/[^A-Za-z0-9-]/g, "") || "edition"}-${form.period}.png`}
                title={title ? `¡Albricias! — ${title}` : "¡Albricias!"}
                edition={issueMeta}
                version={`${layout}:${articles.length}:${fold}`}
              />
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                <span className="font-sans text-[10px] font-bold uppercase tracking-widest text-stone-400 mr-1">
                  Layout
                </span>
                {LAYOUT_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => {
                      setLayout(option.id);
                      setLayoutPickedByHand(true);
                    }}
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
        <div ref={pageRef} className="issue-page">
          <IssueLayout
            layout={layout}
            issue={{ dateLabel: issueMeta.dateLabel }}
            articles={articles}
            streamingArticleIds={streamingIds}
            fold={fold}
          />
        </div>
      </div>
    );
  }

  // Rendered once the saved form is loaded, so the wizard opens on the right step.
  if (!loaded) return <div className="min-h-[60vh]" />;
  return (
    <SetupWizard
      form={form}
      setForm={setForm}
      initialStep={firstIncompleteStep(form)}
      error={error}
      onSubmit={handleSubmit}
    />
  );
}
