import { describe, expect, it } from "vitest";
import type { MixedJourney, MixedLeg } from "@/domain/models";
import {
  filterByBudget,
  maxLegCount,
  payableCents,
  sortByDuration,
  sortByPrice,
  unpricedLegCount,
  withinBudget,
} from "@/domain/regional";

const leg = (over: Partial<MixedLeg> = {}): MixedLeg => ({
  category: "ter",
  mode: "TER",
  trainNo: "881234",
  origin: "A",
  destination: "B",
  departure: "08:00",
  arrival: "09:00",
  minutes: 60,
  priceCents: 1200,
  maxSeat: false,
  ...over,
});

const journey = (over: Partial<MixedJourney> = {}): MixedJourney => ({
  id: "j0",
  date: "2026-09-08",
  departure: "08:00",
  arrival: "12:00",
  arrivesNextDay: false,
  totalMinutes: 240,
  legs: [leg()],
  transfers: 0,
  walkMinutes: 0,
  paidCents: 1200,
  unpricedLegs: 0,
  maxLegs: 0,
  ...over,
});

describe("payableCents", () => {
  it("sums only the legs that are not covered by a MAX seat", () => {
    const legs = [leg({ priceCents: 1500 }), leg({ maxSeat: true, priceCents: 9900 })];
    expect(payableCents(legs)).toBe(1500);
  });

  it("is 0 when every leg is a MAX seat", () => {
    expect(payableCents([leg({ maxSeat: true }), leg({ maxSeat: true })])).toBe(0);
  });

  it("is null as soon as one paid leg has no fare — never a partial sum", () => {
    expect(payableCents([leg({ priceCents: 1500 }), leg({ priceCents: null })])).toBeNull();
  });

  it("ignores a missing fare on a MAX leg, which is free anyway", () => {
    expect(payableCents([leg({ priceCents: 800 }), leg({ maxSeat: true, priceCents: null })])).toBe(
      800,
    );
  });
});

describe("leg counters", () => {
  it("counts MAX legs and unpriced paid legs", () => {
    const legs = [leg({ maxSeat: true }), leg({ priceCents: null }), leg({ priceCents: 500 })];
    expect(maxLegCount(legs)).toBe(1);
    expect(unpricedLegCount(legs)).toBe(1);
  });

  it("does not count a MAX leg as unpriced", () => {
    expect(unpricedLegCount([leg({ maxSeat: true, priceCents: null })])).toBe(0);
  });
});

describe("withinBudget", () => {
  it("keeps a journey at exactly the ceiling", () => {
    expect(withinBudget(journey({ paidCents: 2000 }), { budgetCents: 2000 })).toBe(true);
  });

  it("drops a journey one cent over", () => {
    expect(withinBudget(journey({ paidCents: 2001 }), { budgetCents: 2000 })).toBe(false);
  });

  it("keeps unpriced journeys by default, drops them on request", () => {
    const j = journey({ paidCents: null });
    expect(withinBudget(j, { budgetCents: 100 })).toBe(true);
    expect(withinBudget(j, { budgetCents: 100, dropUnpriced: true })).toBe(false);
  });

  it("filters a list", () => {
    const list = [journey({ id: "a", paidCents: 500 }), journey({ id: "b", paidCents: 5000 })];
    expect(filterByBudget(list, { budgetCents: 1000 }).map((j) => j.id)).toEqual(["a"]);
  });
});

describe("sorting", () => {
  it("puts the cheapest first and unpriced journeys last", () => {
    const list = [
      journey({ id: "unknown", paidCents: null }),
      journey({ id: "pricey", paidCents: 3000 }),
      journey({ id: "cheap", paidCents: 900 }),
    ];
    expect(sortByPrice(list).map((j) => j.id)).toEqual(["cheap", "pricey", "unknown"]);
  });

  it("breaks a price tie with the shorter journey", () => {
    const list = [
      journey({ id: "slow", paidCents: 1000, totalMinutes: 300 }),
      journey({ id: "fast", paidCents: 1000, totalMinutes: 120 }),
    ];
    expect(sortByPrice(list).map((j) => j.id)).toEqual(["fast", "slow"]);
  });

  it("sorts by duration when asked, price as tie-breaker", () => {
    const list = [
      journey({ id: "long", totalMinutes: 400 }),
      journey({ id: "short", totalMinutes: 100 }),
    ];
    expect(sortByDuration(list).map((j) => j.id)).toEqual(["short", "long"]);
  });

  it("does not mutate its input", () => {
    const list = [journey({ id: "b", paidCents: 200 }), journey({ id: "a", paidCents: 100 })];
    sortByPrice(list);
    expect(list.map((j) => j.id)).toEqual(["b", "a"]);
  });
});
