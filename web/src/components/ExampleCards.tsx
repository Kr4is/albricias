/* eslint-disable @next/next/no-img-element */

/**
 * The sample editions as copies on a newsstand: each one folded so only its
 * front — the masthead and the lead — shows, fading into the paper where the
 * fold falls. A card opens that edition (`/examples/[slug]`).
 */

import { SAMPLE_EDITIONS } from "@/lib/sample-editions";

export default function ExampleCards() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-14">
      {SAMPLE_EDITIONS.map((sample) => (
        <a key={sample.slug} href={`/examples/${sample.slug}`} className="group block focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-ink">
          <div className="flex items-baseline justify-between border-b border-ink pb-1.5 mb-4 font-sans text-[10px] font-bold uppercase tracking-widest">
            <span>{sample.cadence}</span>
            <span className="text-stone-500">{sample.edition.dateLabel}</span>
          </div>
          <div className="relative overflow-hidden border border-ink bg-paper shadow-[5px_5px_0_rgba(26,26,26,0.14)] transition duration-300 group-hover:-translate-y-1 group-hover:shadow-[7px_10px_0_rgba(26,26,26,0.18)] motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
            <img
              src={`/examples/${sample.slug}.webp`}
              width={1200}
              height={1500}
              alt={`The front page of a sample ${sample.cadence.toLowerCase()} edition: ${sample.articles[0].title}`}
              loading="lazy"
              className="block w-full h-auto"
            />
            <div aria-hidden className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-paper to-transparent" />
          </div>
          <h3 className="font-headline text-xl font-bold leading-snug mt-5 group-hover:underline underline-offset-4 decoration-1">
            {sample.articles[0].title}
          </h3>
          <p className="font-body text-sm text-stone-600 leading-relaxed mt-1.5">{sample.teaser}</p>
          <span className="inline-block mt-3 font-sans text-[10px] font-bold uppercase tracking-widest border-b border-ink pb-0.5">
            Read this edition →
          </span>
        </a>
      ))}
    </div>
  );
}
