import { WALK_MINUTES } from "./interchanges";
import type { Train } from "./models";
import { durationMinutes, hhmmToMinutes } from "./time";

/** A multi-leg journey (1 leg = direct, 2+ legs = with connections). */
export interface Journey {
  legs: Train[];
  /** First departure, `"HH:MM"`. */
  departure: string;
  /** Final arrival, `"HH:MM"` (may be past midnight, see {@link Journey.arrivesNextDay}). */
  arrival: string;
  /** Door-to-door, in minutes (includes waits at connections). */
  totalMinutes: number;
  /** Number of connections (`legs.length - 1`). */
  transfers: number;
  /** True when the final arrival falls on the next calendar day (night trains). */
  arrivesNextDay: boolean;
}

export interface JourneyOptions {
  /** Maximum trains per journey (1 = direct only). Default 3, capped at 4. */
  maxLegs?: number;
  /** Minimum connection time at a station, minutes. Default 15. */
  minTransferMinutes?: number;
  /** Maximum journeys returned. Default 12. */
  maxResults?: number;
  /**
   * Nom de l'échangeur d'une gare, pour raccorder deux gares mitoyennes que le
   * jeu de données nomme différemment (voir {@link buildInterchanges}).
   * Par défaut, chaque gare n'est qu'elle-même.
   */
  hub?: (station: string) => string;
  /** Marche ajoutée quand la correspondance change de gare. Défaut 10 min. */
  walkMinutes?: number;
}

interface Node {
  legs: Train[];
  /** Arrival time of the last leg, minutes since day start (can exceed 1440). */
  arrivalAbs: number;
  visited: Set<string>;
}

/**
 * Find MAX-seat journeys from `from` to `to` within one day of trains,
 * allowing connections. Depth-first search over trains grouped by origin with
 * Pareto pruning (per station, keep only arrivals not dominated at an equal or
 * lower leg count). All input trains run on the same date; a leg arriving past
 * midnight (night train) can only be a final leg, since no same-date train can
 * depart after it.
 */
export function planJourneys(
  trains: Train[],
  from: string,
  to: string,
  opts: JourneyOptions = {},
): Journey[] {
  const maxLegs = Math.min(opts.maxLegs ?? 3, 4);
  const minTransfer = opts.minTransferMinutes ?? 15;
  const maxResults = opts.maxResults ?? 12;
  const hub = opts.hub ?? ((s: string) => s);
  const walk = opts.walkMinutes ?? WALK_MINUTES;

  const byOrigin = new Map<string, Train[]>();
  for (const t of trains) {
    if (!t.hasMaxSeat) continue;
    const key = hub(t.origin);
    const list = byOrigin.get(key);
    if (list) list.push(t);
    else byOrigin.set(key, [t]);
  }
  for (const list of byOrigin.values()) {
    list.sort((a, b) => hhmmToMinutes(a.departure) - hhmmToMinutes(b.departure));
  }

  // Pareto frontier per station: bestArrival[station][legCount] = earliest arrival seen.
  const best = new Map<string, number[]>();
  const dominated = (station: string, legCount: number, arrivalAbs: number): boolean => {
    const arr = best.get(station);
    if (arr) {
      for (let l = 1; l <= legCount; l += 1) {
        if (arr[l] !== undefined && arr[l] <= arrivalAbs) return true;
      }
    }
    return false;
  };
  const record = (station: string, legCount: number, arrivalAbs: number): void => {
    let arr = best.get(station);
    if (!arr) {
      arr = [];
      best.set(station, arr);
    }
    if (arr[legCount] === undefined || arrivalAbs < arr[legCount]) arr[legCount] = arrivalAbs;
  };

  const journeys: Journey[] = [];
  const stack: Node[] = [];

  // Seed: every MAX train leaving the origin.
  for (const t of byOrigin.get(hub(from)) ?? []) {
    const depAbs = hhmmToMinutes(t.departure);
    stack.push({
      legs: [t],
      arrivalAbs: depAbs + durationMinutes(t.departure, t.arrival),
      visited: new Set([hub(from), hub(t.destination)]),
    });
  }

  while (stack.length) {
    const node = stack.pop() as Node;
    const last = node.legs[node.legs.length - 1];
    const here = hub(last.destination);

    if (here === hub(to)) {
      journeys.push(toJourney(node));
      continue;
    }
    if (node.legs.length >= maxLegs) continue;
    if (dominated(here, node.legs.length, node.arrivalAbs)) continue;
    record(here, node.legs.length, node.arrivalAbs);
    if (node.arrivalAbs >= 24 * 60) continue; // arrived next day: no same-date train follows

    const earliestNext = node.arrivalAbs + minTransfer;
    for (const t of byOrigin.get(here) ?? []) {
      const depAbs = hhmmToMinutes(t.departure);
      // Changer de gare au sein de l'échangeur se fait à pied, pas d'un quai à l'autre.
      if (depAbs < earliestNext + (t.origin === last.destination ? 0 : walk)) continue;
      if (node.visited.has(hub(t.destination))) continue; // no loops
      stack.push({
        legs: [...node.legs, t],
        arrivalAbs: depAbs + durationMinutes(t.departure, t.arrival),
        visited: new Set(node.visited).add(hub(t.destination)),
      });
    }
  }

  journeys.sort(
    (a, b) =>
      arrivalAbsOf(a) - arrivalAbsOf(b) ||
      a.transfers - b.transfers ||
      a.totalMinutes - b.totalMinutes,
  );
  return dedupe(journeys).slice(0, maxResults);
}

function toJourney(node: Node): Journey {
  const first = node.legs[0];
  const last = node.legs[node.legs.length - 1];
  const depAbs = hhmmToMinutes(first.departure);
  return {
    legs: node.legs,
    departure: first.departure,
    arrival: last.arrival,
    totalMinutes: node.arrivalAbs - depAbs,
    transfers: node.legs.length - 1,
    arrivesNextDay: node.arrivalAbs >= 24 * 60,
  };
}

const arrivalAbsOf = (j: Journey): number => hhmmToMinutes(j.departure) + j.totalMinutes;

function dedupe(journeys: Journey[]): Journey[] {
  const seen = new Set<string>();
  return journeys.filter((j) => {
    const key = j.legs.map((l) => l.trainNo + "@" + l.departure).join(">");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Waiting time at each connection, minutes (length = transfers). */
export function transferWaits(j: Journey): number[] {
  const waits: number[] = [];
  for (let i = 1; i < j.legs.length; i += 1) {
    waits.push(hhmmToMinutes(j.legs[i].departure) - hhmmToMinutes(j.legs[i - 1].arrival));
  }
  return waits;
}

/** Une gare atteignable depuis une origine, avec le meilleur trajet trouvé. */
export interface Reachable {
  station: string;
  /** Le trajet qui arrive le plus tôt (direct s'il en existe un). */
  best: Journey;
  /** Nombre de trajets distincts trouvés vers cette gare. */
  journeys: number;
  /** Le plus petit nombre de correspondances vu vers cette gare. */
  minTransfers: number;
}

/**
 * Toutes les gares atteignables depuis `from` dans la journée, correspondances
 * comprises.
 *
 * Même parcours que {@link planJourneys}, mais sans destination imposée : on
 * développe une fois depuis l'origine et on retient, pour chaque gare
 * rencontrée, le trajet qui y arrive le plus tôt. Cela permet de répondre à
 * « où puis-je aller ? » en changeant de train, à partir d'un seul chargement
 * des trains du jour, là où interroger chaque destination une par une
 * demanderait autant de requêtes qu'il y a de gares.
 */
export function reachableFrom(
  trains: Train[],
  from: string,
  opts: JourneyOptions = {},
): Reachable[] {
  const maxLegs = Math.min(opts.maxLegs ?? 2, 4);
  const minTransfer = opts.minTransferMinutes ?? 15;
  const hub = opts.hub ?? ((s: string) => s);
  const walk = opts.walkMinutes ?? WALK_MINUTES;

  const byOrigin = new Map<string, Train[]>();
  for (const t of trains) {
    if (!t.hasMaxSeat) continue;
    const key = hub(t.origin);
    const list = byOrigin.get(key);
    if (list) list.push(t);
    else byOrigin.set(key, [t]);
  }
  for (const list of byOrigin.values()) {
    list.sort((a, b) => hhmmToMinutes(a.departure) - hhmmToMinutes(b.departure));
  }

  const found = new Map<string, Reachable>();
  const seen = new Map<string, number>(); // gare → meilleure arrivée déjà explorée
  const stack: Node[] = [];

  for (const t of byOrigin.get(hub(from)) ?? []) {
    const depAbs = hhmmToMinutes(t.departure);
    stack.push({
      legs: [t],
      arrivalAbs: depAbs + durationMinutes(t.departure, t.arrival),
      visited: new Set([hub(from), hub(t.destination)]),
    });
  }

  while (stack.length) {
    const node = stack.pop() as Node;
    const last = node.legs[node.legs.length - 1];
    const here = hub(last.destination);
    const journey = toJourney(node);

    // La gare d'origine peut réapparaître au bout d'une boucle : ce n'est pas
    // une destination, on ne la propose pas.
    if (here !== hub(from)) {
      const current = found.get(here);
      if (!current) {
        found.set(here, {
          station: here,
          best: journey,
          journeys: 1,
          minTransfers: journey.transfers,
        });
      } else {
        current.journeys += 1;
        current.minTransfers = Math.min(current.minTransfers, journey.transfers);
        if (arrivalAbsOf(journey) < arrivalAbsOf(current.best)) current.best = journey;
      }
    }

    if (node.legs.length >= maxLegs) continue;
    if (node.arrivalAbs >= 24 * 60) continue; // train de nuit : plus rien derrière
    // Ne repartir d'une gare que si on y arrive plus tôt qu'à la visite précédente.
    const before = seen.get(here);
    if (before !== undefined && before <= node.arrivalAbs) continue;
    seen.set(here, node.arrivalAbs);

    const earliestNext = node.arrivalAbs + minTransfer;
    for (const t of byOrigin.get(here) ?? []) {
      const depAbs = hhmmToMinutes(t.departure);
      if (depAbs < earliestNext + (t.origin === last.destination ? 0 : walk)) continue;
      if (node.visited.has(hub(t.destination))) continue;
      stack.push({
        legs: [...node.legs, t],
        arrivalAbs: depAbs + durationMinutes(t.departure, t.arrival),
        visited: new Set(node.visited).add(hub(t.destination)),
      });
    }
  }

  return [...found.values()].sort(
    (a, b) => a.minTransfers - b.minTransfers || arrivalAbsOf(a.best) - arrivalAbsOf(b.best),
  );
}
