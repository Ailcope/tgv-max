import { describe, expect, it } from "vitest";
import { reachableFrom } from "@/domain/connections";
import type { Train } from "@/domain/models";

function train(
  origin: string,
  destination: string,
  departure: string,
  arrival: string,
  hasMaxSeat = true,
): Train {
  return {
    date: "2026-09-07",
    trainNo: `${origin}${destination}${departure}`,
    departure,
    arrival,
    axis: "SUD EST",
    origin,
    destination,
    hasMaxSeat,
  };
}

describe("reachableFrom", () => {
  it("rend les gares desservies en direct", () => {
    const found = reachableFrom([train("A", "B", "08:00", "10:00")], "A");
    expect(found.map((r) => r.station)).toEqual(["B"]);
    expect(found[0].minTransfers).toBe(0);
  });

  it("ouvre les gares qu'on n'atteint qu'en changeant de train", () => {
    const found = reachableFrom(
      [train("A", "B", "08:00", "10:00"), train("B", "C", "10:30", "12:00")],
      "A",
    );
    const c = found.find((r) => r.station === "C");
    expect(c?.minTransfers).toBe(1);
    expect(c?.best.legs).toHaveLength(2);
    expect(c?.best.arrival).toBe("12:00");
  });

  it("respecte le temps de correspondance minimum", () => {
    // Le second train part 5 minutes après l'arrivée du premier : intenable.
    const found = reachableFrom(
      [train("A", "B", "08:00", "10:00"), train("B", "C", "10:05", "12:00")],
      "A",
      { minTransferMinutes: 15 },
    );
    expect(found.map((r) => r.station)).toEqual(["B"]);
  });

  it("s'arrête au nombre de trains demandé", () => {
    const trains = [
      train("A", "B", "08:00", "09:00"),
      train("B", "C", "09:30", "10:30"),
      train("C", "D", "11:00", "12:00"),
    ];
    expect(
      reachableFrom(trains, "A", { maxLegs: 2 })
        .map((r) => r.station)
        .sort(),
    ).toEqual(["B", "C"]);
    expect(
      reachableFrom(trains, "A", { maxLegs: 3 })
        .map((r) => r.station)
        .sort(),
    ).toEqual(["B", "C", "D"]);
  });

  it("ignore les trains sans place MAX", () => {
    const found = reachableFrom([train("A", "B", "08:00", "10:00", false)], "A");
    expect(found).toEqual([]);
  });

  it("ne propose pas la gare de départ comme destination", () => {
    const found = reachableFrom(
      [train("A", "B", "08:00", "10:00"), train("B", "A", "11:00", "13:00")],
      "A",
    );
    expect(found.map((r) => r.station)).toEqual(["B"]);
  });

  it("garde le trajet qui arrive le plus tôt quand plusieurs mènent au même endroit", () => {
    const found = reachableFrom(
      [
        train("A", "B", "08:00", "09:00"),
        train("B", "C", "09:30", "13:00"), // via B : arrivée 13:00
        train("A", "C", "10:00", "12:00"), // direct : arrivée 12:00
      ],
      "A",
    );
    const c = found.find((r) => r.station === "C");
    expect(c?.best.arrival).toBe("12:00");
    expect(c?.minTransfers).toBe(0);
    expect(c?.journeys).toBe(2);
  });

  it("classe les directs avant les correspondances", () => {
    const found = reachableFrom(
      [train("A", "B", "08:00", "09:00"), train("B", "C", "09:30", "10:30")],
      "A",
    );
    expect(found.map((r) => r.minTransfers)).toEqual([0, 1]);
  });

  it("ne repart pas d'un train de nuit arrivé le lendemain", () => {
    const found = reachableFrom(
      [train("A", "B", "22:00", "06:00"), train("B", "C", "08:00", "10:00")],
      "A",
    );
    expect(found.map((r) => r.station)).toEqual(["B"]);
  });
});
