import type { Metadata } from "next";
import ExampleGallery from "@/components/ExampleGallery";
import NewspaperShell from "@/components/NewspaperShell";

export const metadata: Metadata = { title: "¡Albricias! — Sample Editions" };

export default function ExamplesPage() {
  return (
    <NewspaperShell endpoint="examples">
      <div className="max-w-2xl mx-auto py-10 text-center">
        <h1 className="font-headline text-3xl md:text-5xl font-bold leading-tight mb-4">What the press turns out.</h1>
        <p className="font-body text-stone-700 leading-relaxed">
          Three editions, as the PNG export saves them. The people, repositories and numbers are invented — a week,
          a month and a quarter, each set in a different layout. Click one to see it full size.
        </p>
      </div>
      <ExampleGallery />
      <div className="text-center py-12">
        <a
          href="/app"
          className="inline-flex items-center font-sans text-sm font-bold uppercase tracking-widest text-white bg-ink px-8 py-4 hover:opacity-85 transition-opacity"
        >
          Print My Edition
        </a>
      </div>
    </NewspaperShell>
  );
}
