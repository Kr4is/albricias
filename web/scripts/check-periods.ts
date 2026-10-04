/**
 * Runnable self-check for the period maths: an edition covers the last
 * *complete* week, month or quarter. `npx tsx scripts/check-periods.ts`.
 */
import assert from "node:assert/strict";
import { defaultEditionVol, editionBounds } from "../src/lib/cadence";
import { periodLabel } from "../src/lib/edition-helpers";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const bounds = (cadence: Parameters<typeof editionBounds>[0], now: string) => {
  const { periodStart, periodEnd } = editionBounds(cadence, day(now));
  return [periodStart.toISOString().slice(0, 10), periodEnd.toISOString().slice(0, 10)];
};

// Monthly: the 4th of October reports on September, not four days of October.
assert.deepEqual(bounds("monthly", "2026-10-04"), ["2026-09-01", "2026-10-01"]);
assert.deepEqual(bounds("monthly", "2026-10-01"), ["2026-09-01", "2026-10-01"]);
assert.deepEqual(bounds("monthly", "2026-01-15"), ["2025-12-01", "2026-01-01"]);

// Quarterly: the previous calendar quarter, across a year boundary too.
assert.deepEqual(bounds("quarterly", "2026-10-04"), ["2026-07-01", "2026-10-01"]);
assert.deepEqual(bounds("quarterly", "2026-02-10"), ["2025-10-01", "2026-01-01"]);

// Weekly: the previous Monday-to-Monday ISO week (2026-10-04 is a Sunday).
assert.deepEqual(bounds("weekly", "2026-10-04"), ["2026-09-21", "2026-09-28"]);
assert.deepEqual(bounds("weekly", "2026-10-05"), ["2026-09-28", "2026-10-05"]);

// Labels and volume lines.
const q = editionBounds("quarterly", day("2026-10-04"));
assert.equal(periodLabel({ cadence: "quarterly", ...q }), "Q3 2026");
assert.equal(defaultEditionVol({ cadence: "quarterly", ...q }), "VOL. 2026 NO. Q3");
const m = editionBounds("monthly", day("2026-10-04"));
assert.equal(periodLabel({ cadence: "monthly", ...m }), "September 2026");
assert.equal(defaultEditionVol({ cadence: "monthly", ...m }), "VOL. 2026 NO. 9");

console.log("periods self-check: OK");
