import type { MixedJourney, Station } from "@/domain/models";
import { filterByBudget, sortByDuration, sortByPrice } from "@/domain/regional";
import { compact } from "@/lib/dates";
import { normalize } from "@/lib/text";
import type { NavitiaApiClient } from "./NavitiaApiClient";
import { ticketIndex, toMixedJourney } from "./regionalMapper";
import type { TgvmaxRepository } from "./TgvmaxRepository";

export interface RegionalSearchOptions {
  from: Station;
  to: Station;
  /** `"YYYY-MM-DD"`. */
  date: string;
  /** Earliest departure, `"HH:MM"`. */
  time: string;
  /** Ceiling on the paid (non-MAX) legs, in cents. */
  budgetCents: number;
  maxTransfers?: number;
  /** Journeys asked to the API before filtering. */
  count?: number;
  /** Drop journeys the API could not price. */
  dropUnpriced?: boolean;
  /** `"price"` (default) or `"duration"`. */
  sort?: "price" | "duration";
}

/** A station's coordinates as Navitia wants them: `"lon;lat"`. */
const coords = (s: Station): string => `${s.lon};${s.lat}`;

/**
 * Mixed TGV MAX + regional search.
 *
 * Two sources are crossed: the SNCF journey API knows the regional trains and
 * their fares but nothing about MAX quotas, while the « tgvmax » dataset knows
 * exactly which long-distance trains still have a free seat. Matching them on
 * the train number turns those legs into 0 €, so the budget only pays for what
 * MAX does not cover.
 */
export class RegionalRepository {
  constructor(
    private readonly navitia: NavitiaApiClient,
    private readonly tgvmax: TgvmaxRepository,
  ) {}

  async search(options: RegionalSearchOptions): Promise<MixedJourney[]> {
    const [body, maxTrainNos] = await Promise.all([
      this.navitia.journeys({
        from: coords(options.from),
        to: coords(options.to),
        datetime: compact(options.date, options.time),
        count: options.count ?? 8,
        maxTransfers: options.maxTransfers ?? 3,
      }),
      this.maxTrainNumbers(options.date),
    ]);

    const prices = ticketIndex(body.tickets);
    const journeys = (body.journeys ?? [])
      .map((j, i) => toMixedJourney(j, `j${i}`, prices, maxTrainNos))
      .filter((j): j is MixedJourney => j !== null);

    const kept = filterByBudget(journeys, {
      budgetCents: options.budgetCents,
      dropUnpriced: options.dropUnpriced,
    });
    return options.sort === "duration" ? sortByDuration(kept) : sortByPrice(kept);
  }

  /**
   * Train numbers with a free MAX seat that day, normalized for matching.
   * A failure here only costs the 0 € badges, so it degrades to an empty set
   * rather than sinking the whole search.
   */
  private async maxTrainNumbers(date: string): Promise<Set<string>> {
    try {
      const trains = await this.tgvmax.allTrainsOn(date);
      return new Set(trains.filter((t) => t.hasMaxSeat).map((t) => normalize(t.trainNo)));
    } catch {
      return new Set();
    }
  }
}
