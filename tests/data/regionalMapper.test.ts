import { describe, expect, it } from "vitest";
import type { NavitiaJourney, NavitiaTicket } from "@/data/navitiaDto";
import { categorize, placeName, ticketIndex, toMixedJourney } from "@/data/regionalMapper";

describe("categorize", () => {
  it("recognises long-distance trains from either mode wording", () => {
    expect(categorize({ physical_mode: "LongDistanceTrain" })).toBe("tgv");
    expect(categorize({ physical_mode: "Train grande vitesse" })).toBe("tgv");
    expect(categorize({ commercial_mode: "OUIGO" })).toBe("tgv");
    expect(categorize({ commercial_mode: "INTERCITES" })).toBe("tgv");
  });

  it("recognises regional and suburban trains", () => {
    expect(categorize({ physical_mode: "LocalTrain", commercial_mode: "TER" })).toBe("ter");
    expect(categorize({ physical_mode: "Train Express Régional" })).toBe("ter");
    expect(categorize({ commercial_mode: "Transilien" })).toBe("ter");
  });

  it("prefers the long-distance family when both words appear", () => {
    expect(categorize({ physical_mode: "Train", commercial_mode: "TGV INOUI" })).toBe("tgv");
  });

  it("falls back to other for anything else", () => {
    expect(categorize({ physical_mode: "Métro", commercial_mode: "Métro" })).toBe("other");
    expect(categorize(undefined)).toBe("other");
  });
});

describe("placeName", () => {
  it("prefers the stop area over the stop point", () => {
    expect(
      placeName({ stop_point: { name: "Quai 3", stop_area: { name: "Lyon Part-Dieu" } } }),
    ).toBe("Lyon Part-Dieu");
  });

  it("falls back down the chain and finally to a dash", () => {
    expect(placeName({ stop_point: { name: "Quai 3" } })).toBe("Quai 3");
    expect(placeName({ name: "48.8;2.3" })).toBe("48.8;2.3");
    expect(placeName(undefined)).toBe("—");
  });
});

describe("ticketIndex", () => {
  it("reads a centime cost onto the section it covers", () => {
    const tickets: NavitiaTicket[] = [
      {
        cost: { value: "1250", currency: "centime" },
        links: [{ type: "section", id: "s1" }],
      },
    ];
    expect(ticketIndex(tickets).get("s1")).toBe(1250);
  });

  it("splits a through fare across its sections without losing a cent", () => {
    const tickets: NavitiaTicket[] = [
      {
        cost: { value: "1000", currency: "centime" },
        links: [
          { type: "section", id: "a" },
          { type: "section", id: "b" },
          { type: "section", id: "c" },
        ],
      },
    ];
    const index = ticketIndex(tickets);
    expect([...index.values()].reduce((a, b) => a + b, 0)).toBe(1000);
    expect(index.get("a")).toBe(334);
    expect(index.get("b")).toBe(333);
  });

  it("skips tickets with no fare, no cost or no section link", () => {
    const tickets: NavitiaTicket[] = [
      {
        found: false,
        cost: { value: "900", currency: "centime" },
        links: [{ type: "section", id: "s1" }],
      },
      { cost: {}, links: [{ type: "section", id: "s2" }] },
      { cost: { value: "900", currency: "centime" }, links: [{ type: "line", id: "l1" }] },
    ];
    expect(ticketIndex(tickets).size).toBe(0);
  });

  it("treats a real currency as units, not cents", () => {
    const tickets: NavitiaTicket[] = [
      { cost: { value: "12.5", currency: "EUR" }, links: [{ type: "section", id: "s1" }] },
    ];
    expect(ticketIndex(tickets).get("s1")).toBe(1250);
  });
});

const journey = (): NavitiaJourney => ({
  duration: 12600,
  departure_date_time: "20260908T070000",
  arrival_date_time: "20260908T103000",
  sections: [
    { id: "walk", type: "street_network", duration: 600 },
    {
      id: "ter1",
      type: "public_transport",
      departure_date_time: "20260908T071000",
      arrival_date_time: "20260908T080000",
      duration: 3000,
      from: { stop_point: { stop_area: { name: "BESANCON VIOTTE" } } },
      to: { stop_point: { stop_area: { name: "BESANCON FRANCHE COMTE TGV" } } },
      display_informations: {
        physical_mode: "LocalTrain",
        commercial_mode: "TER",
        headsign: "18201",
      },
    },
    {
      id: "tgv1",
      type: "public_transport",
      departure_date_time: "20260908T082000",
      arrival_date_time: "20260908T103000",
      duration: 7800,
      from: { stop_point: { stop_area: { name: "BESANCON FRANCHE COMTE TGV" } } },
      to: { stop_point: { stop_area: { name: "PARIS GARE DE LYON" } } },
      display_informations: {
        physical_mode: "LongDistanceTrain",
        commercial_mode: "TGV INOUI",
        trip_short_name: "6733",
      },
    },
  ],
});

describe("toMixedJourney", () => {
  const prices = new Map([
    ["ter1", 950],
    ["tgv1", 8900],
  ]);

  it("maps sections to legs and prices only what MAX does not cover", () => {
    const j = toMixedJourney(journey(), "j0", prices, new Set(["6733"]));
    expect(j).not.toBeNull();
    expect(j?.legs).toHaveLength(2);
    expect(j?.legs[0]).toMatchObject({
      category: "ter",
      mode: "TER",
      trainNo: "18201",
      maxSeat: false,
    });
    expect(j?.legs[1]).toMatchObject({ category: "tgv", trainNo: "6733", maxSeat: true });
    // 9,50 € de TER ; le TGV est gratuit avec la place MAX.
    expect(j?.paidCents).toBe(950);
    expect(j?.maxLegs).toBe(1);
  });

  it("charges the TGV when no MAX seat is left on that train", () => {
    const j = toMixedJourney(journey(), "j0", prices, new Set());
    expect(j?.paidCents).toBe(9850);
    expect(j?.maxLegs).toBe(0);
  });

  it("reports an unknown total when a paid leg has no ticket", () => {
    const j = toMixedJourney(journey(), "j0", new Map([["tgv1", 8900]]), new Set(["6733"]));
    expect(j?.paidCents).toBeNull();
    expect(j?.unpricedLegs).toBe(1);
  });

  it("keeps times, transfers and walking time", () => {
    const j = toMixedJourney(journey(), "j0", prices, new Set());
    expect(j?.departure).toBe("07:00");
    expect(j?.arrival).toBe("10:30");
    expect(j?.date).toBe("2026-09-08");
    expect(j?.arrivesNextDay).toBe(false);
    expect(j?.transfers).toBe(1);
    expect(j?.walkMinutes).toBe(10);
    expect(j?.totalMinutes).toBe(210);
  });

  it("flags an arrival past midnight", () => {
    const raw = journey();
    raw.arrival_date_time = "20260909T001500";
    expect(toMixedJourney(raw, "j0", prices, new Set())?.arrivesNextDay).toBe(true);
  });

  it("drops a journey with no train at all", () => {
    const raw: NavitiaJourney = {
      departure_date_time: "20260908T070000",
      arrival_date_time: "20260908T071500",
      sections: [{ id: "walk", type: "street_network", duration: 900 }],
    };
    expect(toMixedJourney(raw, "j0", prices, new Set())).toBeNull();
  });
});
