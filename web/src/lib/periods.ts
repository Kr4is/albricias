/**
 * The periods an edition can cover. Client-safe (no Node imports): the form,
 * the API route and the workflow all read the same list.
 */

export const CADENCES = ["weekly", "monthly", "quarterly"] as const;
export type Cadence = (typeof CADENCES)[number];

export const DEFAULT_CADENCE: Cadence = "monthly";

export const CADENCE_LABELS: Record<Cadence, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
};
