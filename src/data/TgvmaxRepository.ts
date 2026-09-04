import { aggregateByDestination, aggregateByOrigin } from "@/domain/availability";
import type { StationDateCount } from "@/domain/heatmap";
import type {
  DailyCounts,
  DestinationAvailability,
  OriginAvailability,
  RangeDestination,
  RangeOrigin,
  Train,
} from "@/domain/models";
import { dateOnly } from "@/lib/dates";
import type { RawTgvmaxRecord } from "./dto";
import { and, filters } from "./query";
import type { SncfApiClient } from "./SncfApiClient";

// Les codes gares (`origine_iata`) sont dans le même espace de codes que le MAX
// Planner officiel : c'est par eux qu'un trajet est rapproché de son nombre de
// places restantes, d'où leur présence dans la projection.
const TRAIN_FIELDS =
  "date,train_no,heure_depart,heure_arrivee,axe,origine,destination," +
  "origine_iata,destination_iata,od_happy_card";

function toTrain(r: RawTgvmaxRecord): Train {
  return {
    date: dateOnly(r.date),
    trainNo: r.train_no,
    departure: r.heure_depart,
    arrival: r.heure_arrivee,
    axis: r.axe,
    origin: r.origine,
    destination: r.destination,
    originCode: r.origine_iata,
    destinationCode: r.destination_iata,
    hasMaxSeat: r.od_happy_card === "OUI",
  };
}

interface DateCountRow {
  date: string;
  n: number;
}
interface DestRangeRow {
  destination: string;
  trains: number;
  days: number;
}
interface OrigRangeRow {
  origine: string;
  trains: number;
  days: number;
}
interface CodePairRow {
  origine_iata: string;
  destination_iata: string;
  n: number;
}
interface StationDateRow {
  date: string;
  trains: number;
  destination?: string;
  origine?: string;
}

/** Domain-level access to TGV MAX availability, built on top of {@link SncfApiClient}. */
export class TgvmaxRepository {
  /** Per-date cache of the full day dump (~2 000 rows), used by the journey planner. */
  private readonly dayCache = new Map<string, Promise<Train[]>>();
  /** Per-O/D cache of the dominant station-code pair (see {@link codePair}). */
  private readonly codeCache = new Map<string, Promise<[string, string] | null>>();

  constructor(private readonly api: SncfApiClient) {}

  /** Every MAX train of one date, all origins/destinations (memoized). */
  allTrainsOn(date: string): Promise<Train[]> {
    let cached = this.dayCache.get(date);
    if (!cached) {
      const where = and(filters.onDate(date), filters.maxSeat());
      cached = this.api
        .all<RawTgvmaxRecord>(where, { select: TRAIN_FIELDS, orderBy: "heure_depart" }, 4000)
        .then((rows) => rows.map(toTrain));
      this.dayCache.set(date, cached);
      cached.catch(() => this.dayCache.delete(date)); // ne pas mettre en cache un échec
    }
    return cached;
  }

  /** MAX trains per day for one O/D (calendar heatmap). */
  async dailyCounts(from: string, to: string): Promise<DailyCounts> {
    const where = and(filters.from(from), filters.to(to), filters.maxSeat());
    const rows = await this.api.all<DateCountRow>(where, {
      groupBy: "date",
      select: "date, count(*) as n",
      orderBy: "date",
    });
    const counts: DailyCounts = {};
    for (const r of rows) counts[dateOnly(r.date)] = r.n;
    return counts;
  }

  /**
   * Trains MAX par gare **et** par date, depuis (ou vers) une gare donnée.
   *
   * C'est la matière de la carte de chaleur. L'agrégation est faite par l'API :
   * refaire trente fois {@link destinationsOn} donnerait le même tableau au prix
   * de trente requêtes et de quelques milliers de lignes rapatriées pour rien.
   */
  async countsByStationAndDate(
    station: string,
    mode: "from" | "to" = "from",
  ): Promise<StationDateCount[]> {
    const other = mode === "from" ? "destination" : "origine";
    const where = and(
      mode === "from" ? filters.from(station) : filters.to(station),
      filters.maxSeat(),
    );
    const rows = await this.api.all<StationDateRow>(
      where,
      {
        groupBy: `${other}, date`,
        select: `${other}, date, count(*) as trains`,
        orderBy: "date",
      },
      6000,
    );
    return rows
      .map((r) => ({
        station: (mode === "from" ? r.destination : r.origine) ?? "",
        date: dateOnly(r.date),
        trains: r.trains,
      }))
      .filter((r) => r.station !== "");
  }

  /** All MAX trains for one O/D on a given date. */
  async trains(from: string, to: string, date: string): Promise<Train[]> {
    const where = and(filters.from(from), filters.to(to), filters.onDate(date), filters.maxSeat());
    const rows = await this.api.all<RawTgvmaxRecord>(where, {
      select: TRAIN_FIELDS,
      orderBy: "heure_depart",
    });
    return rows.map(toTrain);
  }

  /** Every destination with a MAX seat from one station on a date, aggregated. */
  async destinationsOn(from: string, date: string): Promise<DestinationAvailability[]> {
    const where = and(filters.from(from), filters.onDate(date), filters.maxSeat());
    const rows = await this.api.all<RawTgvmaxRecord>(
      where,
      { select: TRAIN_FIELDS, orderBy: "destination" },
      3000,
    );
    return aggregateByDestination(rows.map(toTrain));
  }

  /** Every origin with a MAX seat toward one destination on a date, aggregated. */
  async originsOn(to: string, date: string): Promise<OriginAvailability[]> {
    const where = and(filters.to(to), filters.onDate(date), filters.maxSeat());
    const rows = await this.api.all<RawTgvmaxRecord>(
      where,
      { select: TRAIN_FIELDS, orderBy: "origine" },
      3000,
    );
    return aggregateByOrigin(rows.map(toTrain));
  }

  /** Every destination reachable with a MAX seat over the whole window (map view). */
  async destinationsRange(from: string): Promise<RangeDestination[]> {
    const where = and(filters.from(from), filters.maxSeat());
    const rows = await this.api.all<DestRangeRow>(
      where,
      {
        groupBy: "destination",
        select: "destination, count(*) as trains, count(distinct date) as days",
        orderBy: "trains DESC",
      },
      3000,
    );
    return rows.map((r) => ({ destination: r.destination, trains: r.trains, days: r.days }));
  }

  /** Every origin with a MAX seat toward one destination over the whole window (map view). */
  async originsRange(to: string): Promise<RangeOrigin[]> {
    const where = and(filters.to(to), filters.maxSeat());
    const rows = await this.api.all<OrigRangeRow>(
      where,
      {
        groupBy: "origine",
        select: "origine, count(*) as trains, count(distinct date) as days",
        orderBy: "trains DESC",
      },
      3000,
    );
    return rows.map((r) => ({ origin: r.origine, trains: r.trains, days: r.days }));
  }

  /** All MAX trains for one O/D across the whole window (round-trip planning). */
  async directTrains(from: string, to: string): Promise<Train[]> {
    const where = and(filters.from(from), filters.to(to), filters.maxSeat());
    const rows = await this.api.all<RawTgvmaxRecord>(
      where,
      { select: TRAIN_FIELDS, orderBy: "date" },
      3000,
    );
    return rows.map(toTrain);
  }

  /**
   * The busiest station-code pair on an O/D, e.g. `["FRPLY", "FRLPD"]`.
   *
   * A city label covers several stations (Paris is `FRPLY`, `FRPMO`, `FRPAZ`…)
   * while the remaining-seat service is queried per station. One aggregated
   * query gives the pair that carries most of the traffic, which is the one
   * that describes the link. Memoized: it does not change during a session.
   */
  async codePair(from: string, to: string): Promise<[string, string] | null> {
    const key = `${from}>${to}`;
    let cached = this.codeCache.get(key);
    if (!cached) {
      cached = this.fetchCodePair(from, to);
      this.codeCache.set(key, cached);
      cached.catch(() => this.codeCache.delete(key));
    }
    return cached;
  }

  private async fetchCodePair(from: string, to: string): Promise<[string, string] | null> {
    const rows = await this.api.all<CodePairRow>(
      and(filters.from(from), filters.to(to)),
      {
        groupBy: "origine_iata, destination_iata",
        select: "origine_iata, destination_iata, count(*) as n",
        orderBy: "n DESC",
      },
      100,
    );
    const best = rows[0];
    return best?.origine_iata && best.destination_iata
      ? [best.origine_iata, best.destination_iata]
      : null;
  }

  /** Timestamp of the dataset's last export (data is not real-time). */
  async lastUpdate(): Promise<string | null> {
    try {
      const meta = await this.api.datasetMeta();
      return meta.metas?.default?.data_processed ?? meta.metas?.default?.modified ?? null;
    } catch {
      return null;
    }
  }
}
