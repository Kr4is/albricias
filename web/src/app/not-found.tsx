/* eslint-disable @next/next/no-html-link-for-pages -- see Header.tsx */
import type { Metadata } from "next";
import NewspaperShell from "@/components/NewspaperShell";

export const metadata: Metadata = { title: "Page Not Found - Albricias" };

export default function NotFound() {
  return (
    <NewspaperShell endpoint="home">
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <h1 className="font-masthead text-8xl mb-4">404</h1>
        <h2 className="font-headline text-3xl font-bold mb-4">
          Page Not Found
        </h2>
        <p className="font-body text-lg text-stone-600 mb-8 max-w-md">
          We regret to inform you that the requested page could not be located.
        </p>
        <a
          href="/"
          className="inline-flex items-center font-sans text-sm font-bold uppercase tracking-widest text-ink border border-ink px-6 py-3 hover:bg-ink hover:text-white transition-colors"
        >
          Back to the Front Page
        </a>
      </div>
    </NewspaperShell>
  );
}
