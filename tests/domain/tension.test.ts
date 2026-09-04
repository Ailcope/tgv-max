import { describe, expect, it } from "vitest";
import {
  isAlarming,
  summarizeDay,
  tensionMessage,
  tensionOf,
  tensionOfLegs,
  weakestLeg,
} from "@/domain/tension";

describe("tensionOf", () => {
  it("classe selon le nombre de places restantes", () => {
    expect(tensionOf(60)).toBe("calm");
    expect(tensionOf(41)).toBe("calm");
    expect(tensionOf(40)).toBe("watch");
    expect(tensionOf(16)).toBe("watch");
    expect(tensionOf(15)).toBe("tight");
    expect(tensionOf(6)).toBe("tight");
    expect(tensionOf(5)).toBe("critical");
    expect(tensionOf(1)).toBe("critical");
  });

  it("traite le train complet comme critique", () => {
    expect(tensionOf(0)).toBe("critical");
  });

  it("distingue « on ne sait pas » de « plus de place »", () => {
    expect(tensionOf(undefined)).toBe("unknown");
    expect(tensionOf(Number.NaN)).toBe("unknown");
  });
});

describe("tensionOfLegs", () => {
  it("retient le maillon faible : un trajet ne vaut que par sa jambe la plus juste", () => {
    expect(tensionOfLegs([50, 3])).toBe("critical");
    expect(tensionOfLegs([50, 12])).toBe("tight");
    expect(tensionOfLegs([50, 45])).toBe("calm");
  });

  it("ne rassure pas quand une jambe est inconnue", () => {
    expect(tensionOfLegs([50, undefined])).toBe("unknown");
    expect(weakestLeg([50, undefined])).toBeUndefined();
  });

  it("rend « inconnu » sur une liste vide plutôt que de crier au complet", () => {
    expect(tensionOfLegs([])).toBe("unknown");
  });

  it("expose le nombre de places du maillon faible", () => {
    expect(weakestLeg([50, 3, 20])).toBe(3);
  });
});

describe("isAlarming", () => {
  it("n'allume le rouge que sur les deux niveaux tendus", () => {
    expect(isAlarming("critical")).toBe(true);
    expect(isAlarming("tight")).toBe(true);
    expect(isAlarming("watch")).toBe(false);
    expect(isAlarming("calm")).toBe(false);
    expect(isAlarming("unknown")).toBe(false);
  });
});

describe("tensionMessage", () => {
  it("accorde le pluriel", () => {
    expect(tensionMessage("critical", 1)).toContain("1 place ");
    expect(tensionMessage("critical", 3)).toContain("3 places");
  });

  it("signale qu'une seule jambe est en cause sur un trajet à correspondance", () => {
    expect(tensionMessage("tight", 4, 2)).toContain("sur l'un des trains");
    expect(tensionMessage("tight", 4, 1)).not.toContain("sur l'un des trains");
  });

  it("dit clairement quand il ne reste rien", () => {
    expect(tensionMessage("critical", 0)).toContain("Plus aucune place");
  });
});

describe("summarizeDay", () => {
  it("agrège les propositions d'une journée", () => {
    const day = summarizeDay(
      "2026-09-07",
      [
        { num: "6641", count: 52 },
        { num: "6603", count: 7 },
        { num: "6643", count: 18 },
      ],
      0.47,
    );
    expect(day.seats).toBe(77);
    expect(day.trains).toBe(3);
    expect(day.minSeats).toBe(7);
    expect(day.ratio).toBe(0.47);
    expect(day.byTrain["6603"]).toBe(7);
  });

  it("cumule les espaces d'un même train (assis + couchettes)", () => {
    const day = summarizeDay(
      "2026-09-07",
      [
        { num: "5770", count: 12 },
        { num: "5770", count: 8 },
      ],
      1,
    );
    expect(day.trains).toBe(1);
    expect(day.seats).toBe(20);
    expect(day.minSeats).toBe(20);
  });

  it("supporte une journée sans aucun train", () => {
    const day = summarizeDay("2026-09-06", [], 0);
    expect(day).toMatchObject({ seats: 0, trains: 0, minSeats: 0 });
  });
});
