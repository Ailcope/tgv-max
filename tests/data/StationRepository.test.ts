import { describe, expect, it } from "vitest";
import { StationRepository, type RawStation } from "@/data/StationRepository";

const fixture: RawStation[] = [
  {
    name: "PARIS (intramuros)",
    lat: 48.85,
    lon: 2.35,
    country: "FR",
    traffic: 100,
    ridership: 500,
  },
  {
    name: "MARSEILLE ST CHARLES",
    lat: 43.3,
    lon: 5.38,
    country: "FR",
    traffic: 50,
    ridership: 200,
  },
  { name: "MARSEILLE BLANCARDE", lat: 43.29, lon: 5.4, country: "FR", traffic: 5, ridership: 10 },
  { name: "BARCELONA SANTS", lat: 41.38, lon: 2.14, country: "ES", traffic: 8, ridership: 0 },
  { name: "MASSY TGV", lat: 48.72584, lon: 2.26136, country: "FR", traffic: 40, ridership: 100 },
  {
    name: "MASSY PALAISEAU",
    lat: 48.72663,
    lon: 2.25852,
    country: "FR",
    traffic: 2,
    ridership: 90,
  },
];

const repo = new StationRepository(fixture);

describe("StationRepository.get", () => {
  it("looks up by raw name, accent/paren-insensitive", () => {
    expect(repo.get("PARIS (intramuros)")?.country).toBe("FR");
    expect(repo.get("barcelona sants")?.country).toBe("ES");
    expect(repo.get("Nowhere")).toBeUndefined();
  });
});

describe("StationRepository.search", () => {
  it("returns prefix matches, then inner matches", () => {
    expect(repo.search("marse").map((s) => s.name)).toEqual([
      "MARSEILLE ST CHARLES",
      "MARSEILLE BLANCARDE",
    ]);
  });

  it("is accent-insensitive", () => {
    expect(repo.search("barce").map((s) => s.name)).toEqual(["BARCELONA SANTS"]);
  });

  it("returns the popularity-ordered list for an empty term", () => {
    expect(repo.search("").map((s) => s.name)).toEqual(fixture.map((s) => s.name));
  });

  it("respects the limit", () => {
    expect(repo.search("", 2)).toHaveLength(2);
  });
});

describe("StationRepository.hub", () => {
  it("rend le nom de l'échangeur pour deux gares mitoyennes", () => {
    expect(repo.hub("MASSY PALAISEAU")).toBe("MASSY TGV");
    expect(repo.hub("MASSY TGV")).toBe("MASSY TGV");
  });

  it("laisse seules deux gares que la ville sépare", () => {
    expect(repo.hub("MARSEILLE BLANCARDE")).toBe("MARSEILLE BLANCARDE");
  });

  it("rend le nom tel quel pour une gare inconnue", () => {
    expect(repo.hub("NOWHERE")).toBe("NOWHERE");
  });
});
