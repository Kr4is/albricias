/**
 * The broadsheet page frame from `app/templates/base.html:50-57` — the
 * `max-w-[1400px]` sheet, the header partial and `<main>`.
 *
 * base.html could read `issue`/`article` from Jinja globals; every page here
 * passes them explicitly so the masthead can show the right volume line and
 * weather.
 */

import Header from "@/components/Header";
import type { HeaderProps } from "@/components/Header";

export type NewspaperShellProps = HeaderProps & {
  children: React.ReactNode;
};

export default function NewspaperShell({
  children,
  ...header
}: NewspaperShellProps) {
  return (
    <div className="max-w-[1400px] mx-auto bg-paper shadow-2xl min-h-screen flex flex-col border-x border-stone-200 print:shadow-none print:border-none print:max-w-none">
      <Header {...header} />
      <main className="flex-grow px-6 sm:px-8 lg:px-10 py-6 print:px-0">
        {children}
      </main>
    </div>
  );
}
