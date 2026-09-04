import { describe, expect, it, vi } from "vitest";
import { FreePlacesRepository } from "@/data/FreePlacesRepository";
import type { Train } from "@/domain/models";

const BASE = "https://relais.exemple.fr";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

function train(trainNo: string): Train {
  return {
    date: "2026-09-07",
    trainNo,
    departure: "06:20",
    arrival: "08:22",
    axis: "SUD EST",
    origin: "PARIS (intramuros)",
    destination: "LYON (intramuros)",
    hasMaxSeat: true,
  };
}

describe("FreePlacesRepository", () => {
  it("est inactif sans relais configuré, et ne fait aucun appel", async () => {
    const fetchFn = vi.fn();
    const repo = new FreePlacesRepository("", fetchFn as unknown as typeof fetch);
    expect(repo.enabled).toBe(false);
    expect(await repo.day("FRPLY", "FRLPD", "2026-09-07")).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("construit l'URL attendue par le service", () => {
    const repo = new FreePlacesRepository(BASE + "/");
    const url = repo.buildUrl("FRPLY", "FRLPD", "2026-09-07");
    expect(url).toBe(
      BASE +
        "/search-freeplaces-proposals?origin=FRPLY&destination=FRLPD" +
        "&departureDateTime=2026-09-07T00%3A00%3A00.000Z",
    );
  });

  it("résume une journée", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        proposals: [
          { num: "6641", count: 52 },
          { num: "6603", count: 4 },
        ],
        ratio: 0.32,
      }),
    );
    const repo = new FreePlacesRepository(BASE, fetchFn as unknown as typeof fetch);
    const day = await repo.day("FRPLY", "FRLPD", "2026-09-07");
    expect(day).toMatchObject({ seats: 56, trains: 2, minSeats: 4, ratio: 0.32 });
  });

  it("ne redemande pas deux fois la même journée", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ proposals: [], ratio: 0 }));
    const repo = new FreePlacesRepository(BASE, fetchFn as unknown as typeof fetch);
    await repo.day("FRPLY", "FRLPD", "2026-09-07");
    await repo.day("FRPLY", "FRLPD", "2026-09-07");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("rend null sur erreur plutôt que de propager", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, false, 502));
    const repo = new FreePlacesRepository(BASE, fetchFn as unknown as typeof fetch);
    expect(await repo.day("FRPLY", "FRLPD", "2026-09-07")).toBeNull();
  });

  it("se désactive après trois échecs de suite, pour ne pas marteler un relais mort", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("réseau");
    });
    const repo = new FreePlacesRepository(BASE, fetchFn as unknown as typeof fetch);
    for (const d of ["2026-09-07", "2026-09-08", "2026-09-09"]) {
      await repo.day("FRPLY", "FRLPD", d);
    }
    expect(repo.enabled).toBe(false);
    await repo.day("FRPLY", "FRLPD", "2026-09-10");
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("range ignore les journées en échec sans perdre les autres", async () => {
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("2026-09-08")) return jsonResponse({}, false, 500);
      return jsonResponse({ proposals: [{ num: "1", count: 9 }], ratio: 0.5 });
    });
    const repo = new FreePlacesRepository(BASE, fetchFn as unknown as typeof fetch);
    const out = await repo.range("FRPLY", "FRLPD", ["2026-09-07", "2026-09-08", "2026-09-09"]);
    expect(Object.keys(out).sort()).toEqual(["2026-09-07", "2026-09-09"]);
  });

  it("attache les places aux trains par numéro, et laisse les autres inconnus", () => {
    const day = {
      date: "2026-09-07",
      seats: 60,
      trains: 1,
      minSeats: 60,
      ratio: 1,
      byTrain: { "6641": 60 },
    };
    const [connu, inconnu] = FreePlacesRepository.attach([train("6641"), train("9999")], day);
    expect(connu.seats).toBe(60);
    expect(inconnu.seats).toBeUndefined();
  });

  it("attach rend la liste telle quelle quand la journée est inconnue", () => {
    const list = [train("6641")];
    expect(FreePlacesRepository.attach(list, null)).toBe(list);
  });
});
