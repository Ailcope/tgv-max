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
  /**
   * Station code of the origin, e.g. `"FRPLY"`. Same code space as the official
   * MAX Planner, which is how a train is matched to its remaining-seat count.
   * Absent when the query did not select it.
   */
  originCode?: string;
  /** Station code of the destination, e.g. `"FRLPD"`. */
  destinationCode?: string;
  /** Whether a free MAX seat is available on this train (`od_happy_card === "OUI"`). */
  hasMaxSeat: boolean;
  /**
   * Remaining MAX seats on this train, when the « places libres » relay is
   * configured. `undefined` means « unknown », never « none ».
   */
  seats?: number;
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

/**
 * Remaining MAX seats for one O/D on one date, as published by the official
 * MAX Planner. The open dataset only says « there was a seat at export time »;
 * this says how many are left, which is what tells a tight day from a calm one.
 */
export interface DaySeats {
  /** `"YYYY-MM-DD"`. */
  date: string;
  /** Total seats left across the day. */
  seats: number;
  /** Trains offering at least one seat. */
  trains: number;
  /** Seats on the tightest train of the day (`0` when there is none). */
  minSeats: number;
  /** Share of the day's trains open to MAX, `0`–`1`. */
  ratio: number;
  /** Seats left, per train number. */
  byTrain: Record<string, number>;
}

/** Map of `"YYYY-MM-DD"` → remaining seats that day. */
export type SeatsByDate = Record<string, DaySeats>;
