/** Raw data-transfer objects returned by the SNCF « Navitia » API (subset consumed here). */

/** A place at either end of a section (stop point, stop area, address…). */
export interface NavitiaPlace {
  name?: string;
  stop_point?: { name?: string; stop_area?: { name?: string } };
  stop_area?: { name?: string };
}

/** Human-readable info about the vehicle running a section. */
export interface NavitiaDisplayInformations {
  /** e.g. `"TER"`, `"TGV INOUI"`, `"OUIGO"`. */
  commercial_mode?: string;
  /** e.g. `"LocalTrain"`, `"Train grande vitesse"`. Wording varies by coverage. */
  physical_mode?: string;
  network?: string;
  /** Usually the train number. */
  headsign?: string;
  trip_short_name?: string;
  direction?: string;
}

/** A link from one object to another (`{ type: "section", id: "section_0_0" }`). */
export interface NavitiaLink {
  type?: string;
  id?: string;
  rel?: string;
}

export interface NavitiaSection {
  id?: string;
  /** `"public_transport"`, `"street_network"`, `"transfer"`, `"waiting"`… */
  type?: string;
  /** Local time, compact ISO basic form `"YYYYMMDDTHHMMSS"`. */
  departure_date_time?: string;
  arrival_date_time?: string;
  /** Seconds. */
  duration?: number;
  from?: NavitiaPlace;
  to?: NavitiaPlace;
  display_informations?: NavitiaDisplayInformations;
}

/** A monetary amount; `value` is a string and `currency` is often `"centime"`. */
export interface NavitiaCost {
  value?: string;
  currency?: string;
}

/** A fare ticket, linked to the section(s) it covers. */
export interface NavitiaTicket {
  id?: string;
  name?: string;
  found?: boolean;
  cost?: NavitiaCost;
  links?: NavitiaLink[];
}

export interface NavitiaJourney {
  /** Door-to-door duration, seconds. */
  duration?: number;
  nb_transfers?: number;
  departure_date_time?: string;
  arrival_date_time?: string;
  type?: string;
  fare?: { found?: boolean; total?: NavitiaCost };
  sections?: NavitiaSection[];
}

/** Envelope returned by `/journeys`. Errors come back in the body, not only as a status. */
export interface NavitiaJourneysResponse {
  journeys?: NavitiaJourney[];
  tickets?: NavitiaTicket[];
  error?: { id?: string; message?: string };
  message?: string;
}
