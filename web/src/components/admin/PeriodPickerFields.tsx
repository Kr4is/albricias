/**
 * The period-picker inputs for the "New Edition" and "Generate Edition"
 * forms — a month + year select under the (default) monthly cadence, an
 * `<input type="week">` under weekly. Ported/generalised from the
 * month/year `<select>`+`<input>` pair in `app/templates/admin/edition_new.html`
 * and the modal in `app/templates/admin/editions.html`.
 *
 * Submits as `month`+`year` or `week`, read back by
 * `resolvePeriodFromForm` in `@/lib/cadence`.
 */

import { CADENCE_WEEKLY, MONTHS_LONG, type Cadence, isoWeek } from "@/lib/edition-helpers";
import { toWeekInputValue } from "@/lib/cadence";

export default function PeriodPickerFields({
  cadence,
  now,
}: {
  cadence: Cadence;
  now: Date;
}) {
  if (cadence === CADENCE_WEEKLY) {
    const defaultWeek = toWeekInputValue(isoWeek(now));
    return (
      <div>
        <label className="block text-xs font-sans font-bold uppercase tracking-widest mb-2 border-b border-ink pb-1">
          Week
        </label>
        <input
          type="week"
          name="week"
          defaultValue={defaultWeek}
          required
          className="w-full bg-transparent border-b-2 border-ink-light focus:border-ink px-2 py-2 text-sm font-sans"
        />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="block text-xs font-sans font-bold uppercase tracking-widest mb-2 border-b border-ink pb-1">
          Month
        </label>
        <select
          name="month"
          required
          defaultValue={now.getUTCMonth() + 1}
          className="w-full bg-transparent border-b-2 border-ink-light focus:border-ink px-2 py-2 text-sm font-sans appearance-none"
        >
          {MONTHS_LONG.map((label, index) => (
            <option key={label} value={index + 1}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-sans font-bold uppercase tracking-widest mb-2 border-b border-ink pb-1">
          Year
        </label>
        <input
          type="number"
          name="year"
          defaultValue={now.getUTCFullYear()}
          min={2020}
          max={2099}
          required
          className="w-full bg-transparent border-b-2 border-ink-light focus:border-ink px-2 py-2 text-sm font-sans"
        />
      </div>
    </div>
  );
}
