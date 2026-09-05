import { describe, expect, it } from "vitest";
import { planJourneys, transferWaits } from "@/domain/connections";
import type { Train } from "@/domain/models";

let no = 0;
function train(
  origin: string,
  destination: string,
  departure: string,
  arrival: string,
  hasMaxSeat = true,
): Train {
  no += 1;
  return {
    date: "2026-07-08",
    trainNo: String(1000 + no),
    departure,
    arrival,
    axis: "SUD EST",
    origin,
    destination,
    hasMaxSeat,
  };
}

describe("planJourneys — direct", () => {
  it("finds direct trains and sorts by arrival", () => {
    const res = planJourneys(
      [train("A", "B", "10:00", "12:00"), train("A", "B", "08:00", "10:00")],
      "A",
      "B",
    );
    expect(res).toHaveLength(2);
    expect(res[0].arrival).toBe("10:00");
    expect(res[0].transfers).toBe(0);
    expect(res[0].totalMinutes).toBe(120);
  });

  it("ignores trains without a MAX seat", () => {
    expect(planJourneys([train("A", "B", "08:00", "10:00", false)], "A", "B")).toHaveLength(0);
  });
});

describe("planJourneys — connections", () => {
  it("builds a 2-leg journey when the transfer time is sufficient", () => {
    const res = planJourneys(
      [train("A", "X", "08:00", "10:00"), train("X", "B", "10:30", "12:00")],
      "A",
      "B",
    );
    expect(res).toHaveLength(1);
    expect(res[0].transfers).toBe(1);
    expect(res[0].legs.map((l) => l.origin + ">" + l.destination)).toEqual(["A>X", "X>B"]);
    expect(res[0].totalMinutes).toBe(240); // 08:00 → 12:00, attente comprise
    expect(transferWaits(res[0])).toEqual([30]);
  });

  it("rejects connections tighter than minTransferMinutes", () => {
    const res = planJourneys(
      [train("A", "X", "08:00", "10:00"), train("X", "B", "10:10", "12:00")],
      "A",
      "B",
      { minTransferMinutes: 15 },
    );
    expect(res).toHaveLength(0);
  });

  it("respects maxLegs", () => {
    const trains = [
      train("A", "X", "08:00", "09:00"),
      train("X", "Y", "09:30", "10:30"),
      train("Y", "B", "11:00", "12:00"),
    ];
    expect(planJourneys(trains, "A", "B", { maxLegs: 2 })).toHaveLength(0);
    const res = planJourneys(trains, "A", "B", { maxLegs: 3 });
    expect(res).toHaveLength(1);
    expect(res[0].transfers).toBe(2);
  });

  it("never revisits a station (no loops)", () => {
    const res = planJourneys(
      [
        train("A", "X", "08:00", "09:00"),
        train("X", "A", "09:30", "10:30"), // retour vers A : interdit
        train("A", "B", "11:00", "12:00"),
      ],
      "A",
      "B",
      { maxLegs: 4 },
    );
    expect(res).toHaveLength(1); // seulement le direct 11:00
    expect(res[0].transfers).toBe(0);
  });

  it("prefers earlier arrivals, then fewer transfers", () => {
    const res = planJourneys(
      [
        train("A", "B", "08:00", "13:00"), // direct lent
        train("A", "X", "08:00", "09:00"),
        train("X", "B", "09:30", "11:30"), // via X : arrive plus tôt
      ],
      "A",
      "B",
    );
    expect(res[0].transfers).toBe(1); // arrive 11:30
    expect(res[1].transfers).toBe(0); // arrive 13:00
  });
});

describe("planJourneys — trains de nuit", () => {
  it("marks past-midnight arrivals and forbids onward legs", () => {
    const res = planJourneys(
      [
        train("A", "B", "22:00", "06:30"), // nuit : arrive J+1
        train("B", "C", "08:00", "09:00"), // même date : ne peut PAS suivre
      ],
      "A",
      "C",
    );
    expect(res).toHaveLength(0);
    const direct = planJourneys([train("A", "B", "22:00", "06:30")], "A", "B");
    expect(direct[0].arrivesNextDay).toBe(true);
    expect(direct[0].totalMinutes).toBe(8.5 * 60);
  });
});

describe("planJourneys — bornes", () => {
  it("caps results at maxResults", () => {
    const trains = Array.from({ length: 20 }, (_, i) =>
      train(
        "A",
        "B",
        `${String(6 + Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`,
        `${String(8 + Math.floor(i / 2)).padStart(2, "0")}:00`,
      ),
    );
    expect(planJourneys(trains, "A", "B", { maxResults: 5 })).toHaveLength(5);
  });
});

describe("planJourneys : échangeurs", () => {
  // « X1 » et « X2 » sont les deux noms d'un même échangeur, comme MASSY TGV et
  // MASSY PALAISEAU dans le jeu de données.
  const hub = (s: string): string => (s === "X2" ? "X1" : s);
  const trains = [train("A", "X1", "08:00", "10:00"), train("X2", "B", "10:30", "12:00")];

  it("ne raccorde rien sans regroupement", () => {
    expect(planJourneys(trains, "A", "B")).toHaveLength(0);
  });

  it("raccorde deux trains qu'un court trajet à pied sépare", () => {
    const res = planJourneys(trains, "A", "B", { hub, walkMinutes: 10 });
    expect(res).toHaveLength(1);
    expect(res[0].legs.map((l) => l.origin + ">" + l.destination)).toEqual(["A>X1", "X2>B"]);
  });

  it("ajoute le temps de marche au temps de correspondance", () => {
    // 10:00 + 15 min de correspondance + 20 min de marche = 10:35 > 10:30.
    expect(planJourneys(trains, "A", "B", { hub, walkMinutes: 20 })).toHaveLength(0);
  });

  it("n'ajoute pas de marche quand la correspondance reste dans la même gare", () => {
    const res = planJourneys(
      [train("A", "X1", "08:00", "10:00"), train("X1", "B", "10:15", "12:00")],
      "A",
      "B",
      { hub, walkMinutes: 60 },
    );
    expect(res).toHaveLength(1);
  });

  it("reconnaît la destination sous son autre nom", () => {
    const res = planJourneys([train("A", "X1", "08:00", "10:00")], "A", "X2", { hub });
    expect(res).toHaveLength(1);
    expect(res[0].transfers).toBe(0);
  });

  it("reconnaît l'origine sous son autre nom", () => {
    const res = planJourneys([train("X2", "B", "08:00", "10:00")], "X1", "B", { hub });
    expect(res).toHaveLength(1);
  });

  it("ne repasse pas par un échangeur déjà traversé", () => {
    const res = planJourneys(
      [
        train("A", "X1", "08:00", "09:00"),
        train("X2", "A", "09:30", "10:30"), // retour à A par l'autre quai : interdit
        train("A", "B", "11:00", "12:00"),
      ],
      "A",
      "B",
      { hub, maxLegs: 4 },
    );
    expect(res).toHaveLength(1);
    expect(res[0].transfers).toBe(0);
  });
});
