import { describe, expect, it } from "vitest";
import { buildInterchanges, distanceKm, type GeoStation } from "@/domain/interchanges";

const MASSY_TGV: GeoStation = { name: "MASSY TGV", lat: 48.72584, lon: 2.26136 };
const MASSY_PALAISEAU: GeoStation = { name: "MASSY PALAISEAU", lat: 48.72663, lon: 2.25852 };
const MARSEILLE: GeoStation = { name: "MARSEILLE ST CHARLES", lat: 43.30272, lon: 5.38041 };
const BLANCARDE: GeoStation = { name: "MARSEILLE BLANCARDE", lat: 43.29321, lon: 5.4034 };

describe("distanceKm", () => {
  it("mesure quelques centaines de mètres entre les deux gares de Massy", () => {
    expect(distanceKm(MASSY_TGV, MASSY_PALAISEAU)).toBeCloseTo(0.23, 1);
  });

  it("mesure deux kilomètres entre Saint-Charles et La Blancarde", () => {
    expect(distanceKm(MARSEILLE, BLANCARDE)).toBeGreaterThan(2);
  });
});

describe("buildInterchanges", () => {
  it("regroupe deux gares séparées de quelques centaines de mètres", () => {
    const hubs = buildInterchanges([MASSY_TGV, MASSY_PALAISEAU]);
    expect(hubs.get("MASSY PALAISEAU")).toBe("MASSY TGV");
  });

  it("garde le premier nom de la liste comme nom de l'échangeur", () => {
    const hubs = buildInterchanges([MASSY_PALAISEAU, MASSY_TGV]);
    expect(hubs.get("MASSY TGV")).toBe("MASSY PALAISEAU");
  });

  it("ne regroupe pas deux gares de la même ville qu'un trajet sépare", () => {
    const hubs = buildInterchanges([MARSEILLE, BLANCARDE]);
    expect(hubs.size).toBe(0);
  });

  it("n'inscrit pas une gare qui est elle-même son échangeur", () => {
    const hubs = buildInterchanges([MASSY_TGV, MASSY_PALAISEAU, MARSEILLE]);
    expect([...hubs.keys()]).toEqual(["MASSY PALAISEAU"]);
  });

  it("chaîne les gares proches de proche en proche", () => {
    const a: GeoStation = { name: "A", lat: 48.7, lon: 2.26 };
    const b: GeoStation = { name: "B", lat: 48.7055, lon: 2.26 };
    const c: GeoStation = { name: "C", lat: 48.711, lon: 2.26 };
    const hubs = buildInterchanges([a, b, c]);
    expect(distanceKm(a, c)).toBeGreaterThan(1); // A et C ne se touchent pas
    expect(hubs.get("B")).toBe("A");
    expect(hubs.get("C")).toBe("A"); // mais B les relie
  });
});
