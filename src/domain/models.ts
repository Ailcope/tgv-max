/** Core domain types shared across the app. */

/** A station/city as presented to the user (one entry per city name). */
export interface Station {
  /** Raw SNCF name, e.g. `"PARIS (intramuros)"` — used to query the API. */
  name: string;
  lat: number;
  lon: number;
  /** ISO country code prefix, e.g. `"FR"`, `"DE"`. */
  country: string;
  /** tgvmax occurrence count — used to rank the picker. */
  traffic: number;
  /** Annual ridership (passengers/year); `0` when unknown (e.g. foreign stations). */
  ridership: number;
  /** Normalized search key (accent/paren-insensitive, uppercase). */
  searchKey: string;
}

/** A single scheduled train on a given date and O/D. */
export interface Train {
  /** `"YYYY-MM-DD"`. */
  date: string;
  trainNo: string;
  /** `"HH:MM"`. */
  departure: string;
  /** `"HH:MM"`. */
  arrival: string;
  /** Network axis label, e.g. `"SUD EST"`, `"ATLANTIQUE"`. */
  axis: string;
  origin: string;
  destination: string;
  /** Whether a free MAX seat is available on this train (`od_happy_card === "OUI"`). */
  hasMaxSeat: boolean;
}

/** Map of `"YYYY-MM-DD"` → number of MAX trains that day. */
export type DailyCounts = Record<string, number>;

/** Aggregated availability toward one destination on a specific date. */
export interface DestinationAvailability {
  destination: string;
  trains: number;
  firstDeparture: string;
  fastestMinutes: number;
  list: Train[];
}

/** Aggregated availability from one origin toward a destination on a specific date. */
export interface OriginAvailability {
  origin: string;
  trains: number;
  firstDeparture: string;
  fastestMinutes: number;
  list: Train[];
}

/** Aggregated availability toward one destination over the whole window. */
export interface RangeDestination {
  destination: string;
  trains: number;
  days: number;
}

/** Aggregated availability from one origin over the whole window. */
export interface RangeOrigin {
  origin: string;
  trains: number;
  days: number;
}

/* ---- Voyages mixtes TGV MAX + trains régionaux ---- */

/** What kind of train a leg is, for pricing and display. */
export type LegCategory = "tgv" | "ter" | "other";

/** One public-transport leg of a mixed journey. */
export interface MixedLeg {
  category: LegCategory;
  /** Commercial mode as advertised by SNCF, e.g. `"TER"`, `"TGV INOUI"`. */
  mode: string;
  /** Train number when the API exposes one. */
  trainNo: string | null;
  origin: string;
  destination: string;
  /** `"HH:MM"`. */
  departure: string;
  /** `"HH:MM"`. */
  arrival: string;
  minutes: number;
  /**
   * Fare for this leg in cents, or `null` when the API returned no fare for it.
   * Ignored when {@link MixedLeg.maxSeat} is set — a MAX seat costs 0 €.
   */
  priceCents: number | null;
  /** This leg is a TGV/Intercités with a free MAX seat left on that date. */
  maxSeat: boolean;
}

/** A door-to-door journey mixing free MAX seats and paid regional trains. */
export interface MixedJourney {
  /** Stable key for rendering (position in the API response). */
  id: string;
  /** `"YYYY-MM-DD"` of the first departure. */
  date: string;
  /** `"HH:MM"`. */
  departure: string;
  /** `"HH:MM"`. */
  arrival: string;
  arrivesNextDay: boolean;
  /** Door-to-door, minutes. */
  totalMinutes: number;
  legs: MixedLeg[];
  transfers: number;
  /** Walking/transfer minutes inside and between stations. */
  walkMinutes: number;
  /**
   * What the traveller actually pays: the paid legs only, MAX seats excluded.
   * `null` when at least one paid leg has no known fare.
   */
  paidCents: number | null;
  /** Paid legs whose fare the API could not compute. */
  unpricedLegs: number;
  /** Legs covered by a free MAX seat. */
  maxLegs: number;
}
