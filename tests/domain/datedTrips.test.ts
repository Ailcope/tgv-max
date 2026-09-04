import { describe, expect, it } from "vitest";
import type { Journey } from "@/domain/connections";
import type { Train } from "@/domain/models";
import { asJourney, datesBetween, nightsBetween, planDatedTrips } from "@/domain/roundtrip";

function train(departure: string, arrival: string, origin = "A", destination = "B"): Train {
  return {
    date: "2026-09-07",
    trainNo: "1",
    departure,
    arrival,
    axis: "SUD EST",
    origin,
    destination,
    hasMaxSeat: true,
  };
}

const j = (departure: string, arrival: string): Journey => asJourney(train(departure, arrival));

describe("asJourney", () => {
  it("voit un train direct comme un trajet à une jambe", () => {
    const journey = asJourney(train("08:00", "10:30"));
    expect(journey).toMatchObject({
      departure: "08:00",
      arrival: "10:30",
      totalMinutes: 150,
      transfers: 0,
      arrivesNextDay: false,
    });
  });

  it("repère une arrivée le lendemain", () => {
    expect(asJourney(train("22:00", "06:00")).arrivesNextDay).toBe(true);
  });
});

describe("nightsBetween", () => {
  it("compte les nuits, pas les jours", () => {
    expect(nightsBetween("2026-09-07", "2026-09-07")).toBe(0);
    expect(nightsBetween("2026-09-07", "2026-09-09")).toBe(2);
  });

  it("n'est pas piégé par un changement d'heure", () => {
    // Passage à l'heure d'hiver dans la nuit du 24 au 25 octobre 2026.
    expect(nightsBetween("2026-10-24", "2026-10-26")).toBe(2);
  });
});

describe("datesBetween", () => {
  it("énumère l'intervalle, bornes comprises", () => {
    expect(datesBetween("2026-09-07", "2026-09-09")).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
    ]);
  });

  it("rend une liste vide si la fin précède le début", () => {
    expect(datesBetween("2026-09-09", "2026-09-07")).toEqual([]);
  });

  it("s'arrête au plafond demandé", () => {
    expect(datesBetween("2026-09-01", "2026-12-31", 5)).toHaveLength(5);
  });
});

describe("planDatedTrips", () => {
  const outbound = { "2026-09-07": [j("08:00", "10:00")], "2026-09-08": [j("09:00", "11:00")] };
  const inbound = { "2026-09-09": [j("18:00", "20:00")], "2026-09-10": [j("19:00", "21:00")] };

  it("croise chaque aller avec chaque retour possible", () => {
    const trips = planDatedTrips(outbound, inbound);
    expect(trips).toHaveLength(4);
    expect(trips[0]).toMatchObject({
      departDate: "2026-09-07",
      returnDate: "2026-09-09",
      nights: 2,
    });
  });

  it("ne propose pas de rentrer avant d'être parti", () => {
    const trips = planDatedTrips(
      { "2026-09-08": [j("09:00", "11:00")] },
      { "2026-09-07": [j("18:00", "20:00")] },
    );
    expect(trips).toEqual([]);
  });

  it("refuse un retour qui partirait avant l'arrivée de l'aller, le même jour", () => {
    const trips = planDatedTrips(
      { "2026-09-07": [j("14:00", "18:00")] },
      { "2026-09-07": [j("16:00", "20:00")] },
    );
    expect(trips).toEqual([]);
  });

  it("accepte l'aller-retour dans la journée quand l'ordre tient", () => {
    const trips = planDatedTrips(
      { "2026-09-07": [j("07:00", "09:00")] },
      { "2026-09-07": [j("19:00", "21:00")] },
    );
    expect(trips).toHaveLength(1);
    expect(trips[0].nights).toBe(0);
  });

  it("respecte le nombre de nuits demandé", () => {
    expect(planDatedTrips(outbound, inbound, { minNights: 3 }).every((t) => t.nights >= 3)).toBe(
      true,
    );
    // 08 → 09 est la seule combinaison à une nuit ; les autres en font 2 ou 3.
    const courts = planDatedTrips(outbound, inbound, { maxNights: 1 });
    expect(courts).toHaveLength(1);
    expect(courts[0]).toMatchObject({ departDate: "2026-09-08", returnDate: "2026-09-09" });
  });

  it("garde l'aller qui arrive le plus tôt et le retour qui part le plus tard", () => {
    const trips = planDatedTrips(
      { "2026-09-07": [j("08:00", "12:00"), j("09:00", "10:30")] },
      { "2026-09-09": [j("17:00", "19:00"), j("21:00", "23:00")] },
    );
    expect(trips[0].outbound.arrival).toBe("10:30");
    expect(trips[0].back.departure).toBe("21:00");
  });

  it("ignore une date sans aucun trajet", () => {
    expect(planDatedTrips({ "2026-09-07": [] }, inbound)).toEqual([]);
  });

  it("plafonne le nombre de combinaisons rendues", () => {
    expect(planDatedTrips(outbound, inbound, { maxResults: 2 })).toHaveLength(2);
  });
});
