/**
 * The masthead as an exported PNG shows it: `Header`'s nameplate and rules
 * with this edition's own vol/date/weather, minus the site nav. `Header`
 * itself is an async server component and renders today's date on `/app`
 * (it never learns the generated edition), so the export can't reuse it.
 */

import { NEWSPAPER_CONFIG } from "@/lib/newspaper";

export interface EditionMastheadInfo {
  vol: string;
  dateLabel: string;
  weather: string;
}

export default function EditionMasthead({ edition }: { edition: EditionMastheadInfo }) {
  return (
    <header className="flex flex-col">
      <div className="grid grid-cols-3 items-center py-2 border-b border-ink border-double text-xs font-sans font-bold uppercase tracking-widest">
        <div className="text-left">{edition.vol}</div>
        <div className="text-center">{edition.dateLabel}</div>
        <div className="text-right">{NEWSPAPER_CONFIG.price}</div>
      </div>
      <div className="text-center py-10">
        <h1 className="font-masthead text-[7.5rem] leading-none text-ink drop-shadow-sm tracking-tight">
          {NEWSPAPER_CONFIG.name}
        </h1>
      </div>
      <div className="border-t border-b border-ink py-1.5 mb-1">
        <div className="grid grid-cols-3 items-center text-[10px] font-sans font-bold uppercase tracking-wider">
          <div className="text-left italic font-serif normal-case font-normal text-stone-600">
            &quot;{NEWSPAPER_CONFIG.tagline}&quot;
          </div>
          <div className="text-center">Your Edition</div>
          <div className="text-right">{edition.weather}</div>
        </div>
      </div>
      <div className="border-b-2 border-ink mb-6"></div>
    </header>
  );
}
