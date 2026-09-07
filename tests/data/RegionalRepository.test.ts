import { describe, expect, it, vi } from "vitest";
import type { NavitiaApiClient } from "@/data/NavitiaApiClient";
import type { NavitiaJourneysResponse } from "@/data/navitiaDto";
import { RegionalRepository } from "@/data/RegionalRepository";
import type { TgvmaxRepository } from "@/data/TgvmaxRepository";
import type { Station, Train } from "@/domain/models";

const station = (name: string, lat: number, lon: number): Station => ({
  name,
  lat,
  lon,
  country: "FR",
  traffic: 0,
  ridership: 0,
  searchKey: name,
});

const BESANCON = station("BESANCON VIOTTE", 47.2469, 6.0225);
const PARIS = station("PARIS (intramuros)", 48.8541, 2.3592);

const train = (trainNo: string): Train => ({
  date: "2026-09-08",
  trainNo,
  departure: "08:20",
  arrival: "10:30",
  axis: "SUD EST",
  origin: "BESANCON FRANCHE COMTE TGV",
  destination: "PARIS (intramuros)",
  hasMaxSeat: true,
});

const body = (): NavitiaJourneysResponse => ({
  journeys: [
    {
      duration: 12600,
      departure_date_time: "20260908T070000",
      arrival_date_time: "20260908T103000",
      sections: [
        {
          id: "ter1",
          type: "public_transport",
          departure_date_time: "20260908T071000",
          arrival_date_time: "20260908T080000",
          duration: 3000,
          display_informations: {
            physical_mode: "LocalTrain",
            commercial_mode: "TER",
            headsign: "18201",
          },
        },
        {
          id: "tgv1",
          type: "public_transport",
          departure_date_time: "20260908T082000",
          arrival_date_time: "20260908T103000",
          duration: 7800,
          display_informations: {
            physical_mode: "LongDistanceTrain",
            commercial_mode: "TGV INOUI",
            trip_short_name: "6733",
          },
        },
      ],
    },
    {
      duration: 18000,
      departure_date_time: "20260908T090000",
      arrival_date_time: "20260908T140000",
      sections: [
        {
          id: "ter2",
          type: "public_transport",
          departure_date_time: "20260908T090000",
          arrival_date_time: "20260908T140000",
          duration: 18000,
          display_informations: {
            physical_mode: "LocalTrain",
            commercial_mode: "TER",
            headsign: "18999",
          },
        },
      ],
    },
  ],
  tickets: [
    { cost: { value: "950", currency: "centime" }, links: [{ type: "section", id: "ter1" }] },
    { cost: { value: "8900", currency: "centime" }, links: [{ type: "section", id: "tgv1" }] },
    { cost: { value: "4500", currency: "centime" }, links: [{ type: "section", id: "ter2" }] },
  ],
});

const repo = (
  response: NavitiaJourneysResponse,
  trains: Train[] | Error = [train("6733")],
): { repo: RegionalRepository; journeys: ReturnType<typeof vi.fn> } => {
  const journeys = vi.fn(async () => response);
  const navitia = { journeys } as unknown as NavitiaApiClient;
  const tgvmax = {
    allTrainsOn: async () => {
      if (trains instanceof Error) throw trains;
      return trains;
    },
  } as unknown as TgvmaxRepository;
  return { repo: new RegionalRepository(navitia, tgvmax), journeys };
};

const search = { from: BESANCON, to: PARIS, date: "2026-09-08", time: "07:00" };

describe("RegionalRepository.search", () => {
  it("asks the API for the right coordinates and departure time", async () => {
    const { repo: r, journeys } = repo(body());
    await r.search({ ...search, budgetCents: 5000 });
    expect(journeys).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "6.0225;47.2469",
        to: "2.3592;48.8541",
        datetime: "20260908T070000",
        maxTransfers: 3,
      }),
    );
  });

  it("zeroes the TGV leg when the tgvmax export still has a MAX seat on that train", async () => {
    const { repo: r } = repo(body());
    const [best] = await r.search({ ...search, budgetCents: 5000 });
    expect(best.paidCents).toBe(950); // seul le TER est payant
    expect(best.maxLegs).toBe(1);
  });

  it("drops the journeys above the budget", async () => {
    const { repo: r } = repo(body());
    const found = await r.search({ ...search, budgetCents: 1000 });
    expect(found).toHaveLength(1);
    expect(found[0].legs[0].trainNo).toBe("18201");
  });

  it("sorts by price, then by duration on request", async () => {
    const { repo: r } = repo(body());
    expect((await r.search({ ...search, budgetCents: 10000 })).map((j) => j.paidCents)).toEqual([
      950, 4500,
    ]);
    const byTime = await r.search({ ...search, budgetCents: 10000, sort: "duration" });
    expect(byTime.map((j) => j.totalMinutes)).toEqual([210, 300]);
  });

  it("still returns journeys when the tgvmax dataset is unreachable — just without the 0 € legs", async () => {
    const { repo: r } = repo(body(), new Error("SNCF API 500"));
    const found = await r.search({ ...search, budgetCents: 100000 });
    expect(found[0].maxLegs).toBe(0);
    expect(found.map((j) => j.paidCents).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([4500, 9850]);
  });

  it("returns nothing when the API found no journey", async () => {
    const { repo: r } = repo({ journeys: [], tickets: [] });
    expect(await r.search({ ...search, budgetCents: 5000 })).toEqual([]);
  });
});
