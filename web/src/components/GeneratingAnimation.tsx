"use client";

/** Full-screen spinner shown until the first section streams in — `message` comes from the server's `status` SSE events. */

export default function GeneratingAnimation({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center gap-6">
      <span className="material-icons text-5xl animate-spin text-ink" aria-hidden="true">
        autorenew
      </span>
      <p className="font-headline text-2xl" aria-live="polite">
        {message}
      </p>
      <p className="font-sans text-xs uppercase tracking-widest text-stone-500">
        This can take a minute or two
      </p>
    </div>
  );
}
