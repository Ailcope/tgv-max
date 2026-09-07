/**
 * Pure rules for mixed TGV MAX + regional journeys: what the traveller really
 * pays, and how the budget ceiling filters the results.
 *
 * The whole point of the mode: a MAX seat is free, so only the *other* legs —
 * in practice the regional trains — spend the budget.
 */
import type { MixedJourney, MixedLeg } from "./models";

/** Legs the traveller pays for: everything not covered by a MAX seat. */
export const paidLegs = (legs: readonly MixedLeg[]): MixedLeg[] => legs.filter((l) => !l.maxSeat);

/** Legs covered by a free MAX seat. */
export const maxLegCount = (legs: readonly MixedLeg[]): number =>
  legs.reduce((n, l) => n + (l.maxSeat ? 1 : 0), 0);

/** Paid legs the API could not price. */
export const unpricedLegCount = (legs: readonly MixedLeg[]): number =>
  paidLegs(legs).reduce((n, l) => n + (l.priceCents == null ? 1 : 0), 0);

/**
 * Total payable for a journey, in cents. `null` as soon as one paid leg has no
 * known fare: a partial sum would silently understate the price and slip past
 * the budget filter, so the UI shows « prix incomplet » instead of guessing.
 */
export function payableCents(legs: readonly MixedLeg[]): number | null {
  let total = 0;
  for (const leg of paidLegs(legs)) {
    if (leg.priceCents == null) return null;
    total += leg.priceCents;
  }
  return total;
}

export interface BudgetFilter {
  /** Ceiling on the sum of the paid legs, in cents. */
  budgetCents: number;
  /** Drop journeys whose total price is unknown. Default `false` (kept, flagged). */
  dropUnpriced?: boolean;
}

/** Does a journey fit the budget? Unpriced journeys are kept unless asked otherwise. */
export function withinBudget(journey: MixedJourney, filter: BudgetFilter): boolean {
  if (journey.paidCents == null) return !filter.dropUnpriced;
  return journey.paidCents <= filter.budgetCents;
}

export const filterByBudget = (journeys: MixedJourney[], filter: BudgetFilter): MixedJourney[] =>
  journeys.filter((j) => withinBudget(j, filter));

/** Cheapest first, then fastest. Journeys with an unknown price go last. */
export function sortByPrice(journeys: MixedJourney[]): MixedJourney[] {
  return [...journeys].sort((a, b) => {
    if ((a.paidCents == null) !== (b.paidCents == null)) return a.paidCents == null ? 1 : -1;
    if (a.paidCents != null && b.paidCents != null && a.paidCents !== b.paidCents) {
      return a.paidCents - b.paidCents;
    }
    if (a.totalMinutes !== b.totalMinutes) return a.totalMinutes - b.totalMinutes;
    return a.departure.localeCompare(b.departure);
  });
}

/** Fastest first, price as a tie-breaker. */
export function sortByDuration(journeys: MixedJourney[]): MixedJourney[] {
  return [...journeys].sort(
    (a, b) =>
      a.totalMinutes - b.totalMinutes || (a.paidCents ?? Infinity) - (b.paidCents ?? Infinity),
  );
}
