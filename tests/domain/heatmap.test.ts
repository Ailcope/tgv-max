import { describe, expect, it } from "vitest";
import { buildHeatmap, heatDates, heatPeak, type StationDateCount } from "@/domain/heatmap";

const count = (station: string, date: string, trains: number): StationDateCount => ({
  station,
  date,
  trains,
});

describe("heatDates", () => {
  it("rend la fenêtre demandée à partir du jour donné", () => {
    expect(heatDates(3, new Date(2026, 8, 5))).toEqual(["2026-09-05", "2026-09-06", "2026-09-07"]);
  });

  it("passe les fins de mois sans trou", () => {
    expect(heatDates(2, new Date(2026, 8, 30))).toEqual(["2026-09-30", "2026-10-01"]);
  });

  it("rend une fenêtre vide plutôt que de planter sur un nombre négatif", () => {
    expect(heatDates(-1)).toEqual([]);
  });
});

describe("buildHeatmap", () => {
  const dates = ["2026-09-05", "2026-09-06", "2026-09-07"];

  it("range les gares de la mieux desservie à la moins bien", () => {
    const rows = buildHeatmap(
      [
        count("LYON (intramuros)", "2026-09-05", 3),
        count("MARSEILLE ST CHARLES", "2026-09-05", 9),
        count("LYON (intramuros)", "2026-09-06", 2),
      ],
      dates,
    );
    expect(rows.map((r) => r.station)).toEqual(["MARSEILLE ST CHARLES", "LYON (intramuros)"]);
    expect(rows[0].total).toBe(9);
    expect(rows[1].total).toBe(5);
    expect(rows[1].days).toBe(2);
  });

  it("ignore ce qui tombe hors de la fenêtre au lieu de le replier sur un bord", () => {
    const rows = buildHeatmap(
      [count("LYON (intramuros)", "2026-09-06", 4), count("LYON (intramuros)", "2026-10-01", 99)],
      dates,
    );
    expect(rows[0].total).toBe(4);
    expect(rows[0].byDate["2026-10-01"]).toBeUndefined();
  });

  it("additionne deux comptages tombant sur la même case", () => {
    const rows = buildHeatmap(
      [count("LYON (intramuros)", "2026-09-05", 2), count("LYON (intramuros)", "2026-09-05", 3)],
      dates,
    );
    expect(rows[0].byDate["2026-09-05"]).toBe(5);
    expect(rows[0].days).toBe(1);
  });

  it("désigne le jour le mieux desservi, et le plus proche à égalité", () => {
    const rows = buildHeatmap(
      [
        count("LYON (intramuros)", "2026-09-05", 4),
        count("LYON (intramuros)", "2026-09-06", 7),
        count("LYON (intramuros)", "2026-09-07", 7),
      ],
      dates,
    );
    expect(rows[0].bestDate).toBe("2026-09-06");
  });

  it("coupe la queue de distribution au nombre de lignes demandé", () => {
    const many = Array.from({ length: 60 }, (_, i) => count(`GARE ${i}`, "2026-09-05", 60 - i));
    expect(buildHeatmap(many, dates, 40)).toHaveLength(40);
  });

  it("ne garde pas une gare dont tous les comptages sont nuls", () => {
    expect(buildHeatmap([count("LYON (intramuros)", "2026-09-05", 0)], dates)).toEqual([]);
  });
});

describe("heatPeak", () => {
  it("rend la case la plus fournie du tableau, pas le total d'une ligne", () => {
    const rows = buildHeatmap(
      [
        count("LYON (intramuros)", "2026-09-05", 4),
        count("LYON (intramuros)", "2026-09-06", 4),
        count("MARSEILLE ST CHARLES", "2026-09-05", 6),
      ],
      ["2026-09-05", "2026-09-06"],
    );
    expect(heatPeak(rows)).toBe(6);
  });

  it("rend 0 sur un tableau vide", () => {
    expect(heatPeak([])).toBe(0);
  });
});
