import type { Metadata } from "next";
import NewspaperShell from "@/components/NewspaperShell";

export const metadata: Metadata = { title: "¡Albricias! — Your GitHub, Set in Vintage Type" };

const STEPS = [
  {
    title: "Enter your username",
    body: "Just your public GitHub handle — nothing is connected, nothing is authorized.",
  },
  {
    title: "Pick a period",
    body: "Yesterday's commits, this week's pull requests, or a whole month of releases and stars.",
  },
  {
    title: "Bring your own AI",
    body: "OpenAI, Gemini, or your own LLM gateway. Your key, used once, never stored.",
  },
  {
    title: "Watch it go to press",
    body: "A correspondent's desk turns your activity into a front page — no two look alike.",
  },
];

export default function LandingPage() {
  return (
    <NewspaperShell endpoint="home">
      <div className="max-w-2xl mx-auto py-12 text-center">
        <h1 className="font-headline text-4xl md:text-6xl font-bold leading-tight mb-6">
          Your GitHub activity, printed like it mattered.
        </h1>
        <p className="font-body text-lg text-stone-700 leading-relaxed mb-10 max-w-xl mx-auto">
          ¡Albricias! turns a GitHub username into a vintage broadsheet front
          page — commits, pull requests, releases and stars, written up by an
          AI correspondent in the grandiloquent voice of a bygone newsroom.
        </p>
        <a
          href="/app"
          className="inline-flex items-center font-sans text-sm font-bold uppercase tracking-widest text-white bg-ink px-8 py-4 hover:opacity-85 transition-opacity"
        >
          Print My Edition
        </a>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-stone-300 py-12 border-t border-ink border-double">
        {STEPS.map((step, index) => (
          <div key={step.title} className="flex gap-4 lg:px-8 first:pl-0 last:pr-0">
            <span className="font-headline text-3xl font-bold text-stone-300 leading-none">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div>
              <h2 className="font-headline text-lg font-bold mb-1">{step.title}</h2>
              <p className="font-body text-sm text-stone-600 leading-relaxed">{step.body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="max-w-2xl mx-auto text-center py-10 border-t border-ink border-double">
        <p className="font-body text-sm text-stone-500 italic">
          Nothing you generate is saved. No accounts, no history — every
          edition is set fresh, read, and struck from the press.
        </p>
      </div>
    </NewspaperShell>
  );
}
