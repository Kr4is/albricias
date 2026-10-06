import type { Metadata } from "next";
import { notFound } from "next/navigation";
import NewspaperShell from "@/components/NewspaperShell";
import SampleIssue from "@/components/SampleIssue";
import { SAMPLE_EDITIONS, sampleBySlug } from "@/lib/sample-editions";

export const dynamicParams = false;

export function generateStaticParams() {
  return SAMPLE_EDITIONS.map((sample) => ({ slug: sample.slug }));
}

export async function generateMetadata({ params }: PageProps<"/examples/[slug]">): Promise<Metadata> {
  const sample = sampleBySlug((await params).slug);
  return { title: sample ? `¡Albricias! — Sample ${sample.cadence} Edition` : "¡Albricias!" };
}

const PILL = "px-3 py-1.5 font-sans text-[10px] font-bold uppercase tracking-widest border transition-colors";

export default async function SamplePage({ params }: PageProps<"/examples/[slug]">) {
  const sample = sampleBySlug((await params).slug);
  if (!sample) notFound();

  return (
    <NewspaperShell endpoint="examples">
      <div className="mb-6 no-print flex flex-col items-center gap-4 text-center">
        <p className="font-body text-sm text-stone-600 italic max-w-xl">
          A sample {sample.cadence.toLowerCase()} edition, set exactly as yours would be. The people, repositories and
          numbers in it are invented.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {SAMPLE_EDITIONS.map((other) => (
            <a
              key={other.slug}
              href={`/examples/${other.slug}`}
              aria-current={other.slug === sample.slug ? "page" : undefined}
              className={`${PILL} ${other.slug === sample.slug ? "bg-ink text-white border-ink" : "bg-white text-ink border-stone-300 hover:border-ink"}`}
            >
              {other.cadence}
            </a>
          ))}
          <a
            href="/app"
            className="ml-3 px-4 py-1.5 font-sans text-[10px] font-bold uppercase tracking-widest text-white bg-ink hover:opacity-85 transition-opacity"
          >
            Print My Edition
          </a>
        </div>
      </div>
      <SampleIssue sample={sample} />
    </NewspaperShell>
  );
}
