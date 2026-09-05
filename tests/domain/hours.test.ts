import { describe, expect, it } from "vitest";
import { ANY_HOUR, isOpen, trainWithinHours, withinHours } from "@/domain/hours";
import type { Train } from "@/domain/models";

const H = (h: number): number => h * 60;

function train(departure: string, arrival: string): Train {
  return {
    date: "2026-09-08",
    trainNo: "1",
    departure,
    arrival,
    axis: "SUD EST",
    origin: "PARIS (intramuros)",
    destination: "LYON (intramuros)",
    hasMaxSeat: true,
  };
}

describe("isOpen", () => {
  it("sans borne, la plage laisse tout passer", () => {
    expect(isOpen(ANY_HOUR)).toBe(true);
    expect(isOpen({ after: H(8), before: 0 })).toBe(false);
  });
});

describe("withinHours", () => {
  it("écarte un départ trop matinal", () => {
    expect(withinHours("06:00", "09:00", false, { after: H(8), before: 0 })).toBe(false);
    expect(withinHours("08:00", "11:00", false, { after: H(8), before: 0 })).toBe(true);
  });

  it("écarte une arrivée trop tardive", () => {
    expect(withinHours("18:00", "23:30", false, { after: 0, before: H(22) })).toBe(false);
    expect(withinHours("18:00", "21:00", false, { after: 0, before: H(22) })).toBe(true);
  });

  it("accepte une borne posée exactement sur l'horaire", () => {
    expect(withinHours("08:00", "22:00", false, { after: H(8), before: H(22) })).toBe(true);
  });

  it("compte l'arrivée du lendemain comme tardive, pas comme matinale", () => {
    // Un train de nuit parti à 22:30 arrive à 06:15 le lendemain : il ne
    // respecte pas « arrivée avant 22:00 », même si 06:15 précède 22:00.
    expect(withinHours("22:30", "06:15", true, { after: 0, before: H(22) })).toBe(false);
  });

  it("laisse passer un train de nuit quand aucune arrivée n'est exigée", () => {
    expect(withinHours("22:30", "06:15", true, { after: H(20), before: 0 })).toBe(true);
  });

  it("sans borne, tout passe", () => {
    expect(withinHours("03:00", "05:00", false, ANY_HOUR)).toBe(true);
  });
});

describe("trainWithinHours", () => {
  it("déduit le passage de minuit de l'horaire", () => {
    expect(trainWithinHours(train("22:30", "06:15"), { after: 0, before: H(23) })).toBe(false);
    expect(trainWithinHours(train("08:00", "11:00"), { after: 0, before: H(23) })).toBe(true);
  });
});
