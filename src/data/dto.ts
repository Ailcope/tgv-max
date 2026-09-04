/** Raw data-transfer objects returned by the SNCF OpenDataSoft API. */

/** A raw record from the « tgvmax » dataset. */
export interface RawTgvmaxRecord {
  date: string;
  train_no: string;
  entity: string;
  axe: string;
  origine_iata: string;
  destination_iata: string;
  origine: string;
  destination: string;
  heure_depart: string;
  heure_arrivee: string;
  od_happy_card: "OUI" | "NON";
}

/** Envelope returned by the records endpoint. */
export interface RecordsResponse<T> {
  total_count: number;
  results: T[];
}

/** Dataset metadata envelope (subset we care about). */
export interface DatasetMeta {
  metas?: { default?: { data_processed?: string; modified?: string } };
}

/**
 * Une proposition du service « places libres » du MAX Planner : un train, et
 * surtout `count`, le nombre de places MAX encore réservables dessus.
 * Les horaires sont des `"YYYY-MM-DDTHH:MM"` sans fuseau (heure locale).
 */
export interface RawFreePlacesProposal {
  /** Arrivée, `"2026-09-07T08:22"`. */
  arr: string;
  /** Places MAX restantes sur ce train. */
  count: number;
  /** Départ, `"2026-09-07T06:20"`. */
  dep: string;
  dest: string;
  /** Numéro de train, `"6641"`. */
  num: string;
  orig: string;
  /** `"ASSIS"`, `"COUCHETTE"`… */
  space: string;
  /** `"INOUI"`, `"OUIGO"`… */
  type: string;
}

/** Réponse du service « places libres » pour un O/D et une date. */
export interface FreePlacesResponse {
  proposals: RawFreePlacesProposal[];
  /** Part des trains du jour qui proposent des places MAX, entre 0 et 1. */
  ratio: number;
  /** Horodatage de la dernière actualisation côté SNCF (millisecondes). */
  updated?: number;
}
