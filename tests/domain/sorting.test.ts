import { describe, expect, it } from "vitest";
import type { Train } from "@/domain/models";
import { fastestTrain, sortTrains, tripMinutes } from "@/domain/sorting";

function train(departure: string, arrival: string, trainNo = "1"): Train {
  return {
    date: "2026-09-08",
    trainNo,
    departure,
    arrival,
    axis: "SUD EST",
    origin: "PARIS (intramuros)",
    destination: "LYON (intramuros)",
    hasMaxSeat: true,
  };
}

describe("tripMinutes", () => {
  it("compte les minutes d'un trajet", () => {
    expect(tripMinutes(train("08:00", "11:30"))).toBe(210);
  });

  it("gère le passage de minuit des trains de nuit", () => {
    expect(tripMinutes(train("22:30", "06:15"))).toBe(465);
  });
});

describe("sortTrains", () => {
  const list = [
    train("18:00", "20:00", "c"),
    train("07:00", "14:00", "a"),
    train("09:00", "11:00", "b"),
  ];

  it("range par heure de départ", () => {
    expect(sortTrains(list, "departure").map((t) => t.trainNo)).toEqual(["a", "b", "c"]);
  });

  it("range par durée", () => {
    expect(sortTrains(list, "duration").map((t) => t.trainNo)).toEqual(["b", "c", "a"]);
  });

  it("départage deux durées égales par l'heure de départ", () => {
    const tied = [train("17:00", "19:00", "soir"), train("06:00", "08:00", "matin")];
    expect(sortTrains(tied, "duration").map((t) => t.trainNo)).toEqual(["matin", "soir"]);
  });

  it("ne modifie pas la liste reçue", () => {
    const original = [...list];
    sortTrains(list, "duration");
    expect(list).toEqual(original);
  });
});

describe("fastestTrain", () => {
  it("désigne le trajet le plus court", () => {
    const list = [train("07:00", "14:00", "long"), train("09:00", "11:00", "court")];
    expect(fastestTrain(list)?.trainNo).toBe("court");
  });

  it("à égalité, désigne le plus matinal", () => {
    const list = [train("17:00", "19:00", "soir"), train("06:00", "08:00", "matin")];
    expect(fastestTrain(list)?.trainNo).toBe("matin");
  });

  it("rend null sur une liste vide", () => {
    expect(fastestTrain([])).toBeNull();
  });

  it("compare correctement un train de nuit", () => {
    const list = [train("22:30", "06:15", "nuit"), train("08:00", "11:00", "jour")];
    expect(fastestTrain(list)?.trainNo).toBe("jour");
  });
});
