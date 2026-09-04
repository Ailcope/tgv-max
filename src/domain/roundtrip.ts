import { addDays, iso, nextSaturday, parseISO } from "@/lib/dates";
import type { Train } from "./models";
import type { Journey } from "./connections";
import { durationMinutes, hhmmToMinutes } from "./time";

/** Trains grouped by `"YYYY-MM-DD"`. */
export type TrainsByDate = Record<string, Train[]>;

/** One feasible same-day round trip. */
export interface DayTrip {
  date: string;
  outbound: Train;
  back: Train;
  /** Minutes spent at destination between arrival and return departure. */
  stayMinutes: number;
}

/** One weekend with MAX seats available in both directions. */
export interface WeekendTrip {
  /** The Saturday anchoring the weekend. */
  saturday: string;
  /** Candidate outbound dates (Friday and/or Saturday). */
  departDates: string[];
  /** Candidate return dates (Sunday and/or Monday). */
  returnDates: string[];
}

export function groupByDate(trains: Train[]): TrainsByDate {
  const map: TrainsByDate = {};
  for (const t of trains) (map[t.date] ??= []).push(t);
  return map;
}

const earliestArrival = (list: Train[]): Train =>
  list.reduce((a, b) => (hhmmToMinutes(b.arrival) < hhmmToMinutes(a.arrival) ? b : a));

const latestDeparture = (list: Train[]): Train =>
  list.reduce((a, b) => (hhmmToMinutes(b.departure) > hhmmToMinutes(a.departure) ? b : a));

/**
 * Same-day round trips: for each date present in both directions, pick the
 * earliest-arriving outbound and latest-departing return, keeping those that
 * leave at least `minStayMinutes` at destination. Inputs should already be
 * filtered by any time constraints.
 */
export function planDayTrips(
  outboundByDate: TrainsByDate,
  inboundByDate: TrainsByDate,
  minStayMinutes: number,
): DayTrip[] {
  const trips: DayTrip[] = [];
  for (const date of Object.keys(outboundByDate)) {
    const outs = outboundByDate[date];
    const ins = inboundByDate[date];
    if (!outs?.length || !ins?.length) continue;
    const outbound = earliestArrival(outs);
    const back = latestDeparture(ins);
    const stayMinutes = hhmmToMinutes(back.departure) - hhmmToMinutes(outbound.arrival);
    if (stayMinutes >= minStayMinutes) trips.push({ date, outbound, back, stayMinutes });
  }
  return trips.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Weekend getaways: leave Friday or Saturday, return Sunday or Monday, with a
 * MAX seat available in each direction. Scans the next `weeks` weekends.
 */
export function planWeekends(
  outboundByDate: TrainsByDate,
  inboundByDate: TrainsByDate,
  from: Date,
  weeks = 6,
): WeekendTrip[] {
  const combos: WeekendTrip[] = [];
  const fromIso = iso(from);
  let d = nextSaturday(from);
  for (let w = 0; w < weeks; w += 1, d = addDays(d, 7)) {
    const fri = iso(addDays(d, -1));
    const sat = iso(d);
    const sun = iso(addDays(d, 1));
    const mon = iso(addDays(d, 2));
    const departDates = [fri, sat].filter(
      (x) => (outboundByDate[x]?.length ?? 0) > 0 && x >= fromIso,
    );
    const returnDates = [sun, mon].filter((x) => (inboundByDate[x]?.length ?? 0) > 0);
    if (departDates.length && returnDates.length)
      combos.push({ saturday: sat, departDates, returnDates });
  }
  return combos;
}

/**
 * Un aller-retour sur des dates choisies : un trajet aller un jour, un trajet
 * retour un autre. Chaque sens peut comporter des correspondances, d'où des
 * {@link Journey} plutôt que des {@link Train}.
 */
export interface DatedTrip {
  departDate: string;
  returnDate: string;
  /** Nuits passées sur place (`0` = aller-retour dans la journée). */
  nights: number;
  outbound: Journey;
  back: Journey;
}

export interface DatedTripOptions {
  /** Nuits minimum sur place. `0` autorise l'aller-retour dans la journée. */
  minNights?: number;
  maxNights?: number;
  /** Combinaisons rendues. Par défaut 30. */
  maxResults?: number;
}

/** Un trajet direct vu comme un {@link Journey} à une seule jambe. */
export function asJourney(t: Train): Journey {
  const total = durationMinutes(t.departure, t.arrival);
  return {
    legs: [t],
    departure: t.departure,
    arrival: t.arrival,
    totalMinutes: total,
    transfers: 0,
    arrivesNextDay: hhmmToMinutes(t.departure) + total >= 24 * 60,
  };
}

/**
 * Croise des allers et des retours datés.
 *
 * Les deux sens arrivent déjà filtrés (heures, correspondances autorisées ou
 * non) : cette fonction ne fait que l'appariement. Pour chaque couple de dates
 * retenu, elle garde le meilleur aller (arrivée la plus tôt) et le meilleur
 * retour (départ le plus tard) : c'est ce qui laisse le plus de temps sur
 * place, et c'est ce qu'on cherche presque toujours.
 *
 * Un aller-retour le même jour n'est retenu que si le retour part après
 * l'arrivée de l'aller : sans cette garde, on proposerait de rentrer avant
 * d'être parti.
 */
export function planDatedTrips(
  outbound: Record<string, Journey[]>,
  inbound: Record<string, Journey[]>,
  options: DatedTripOptions = {},
): DatedTrip[] {
  const minNights = options.minNights ?? 0;
  const maxNights = options.maxNights ?? 30;
  const maxResults = options.maxResults ?? 30;

  const trips: DatedTrip[] = [];
  const departDates = Object.keys(outbound).sort();
  const returnDates = Object.keys(inbound).sort();

  for (const departDate of departDates) {
    const outs = outbound[departDate];
    if (!outs?.length) continue;
    const best = outs.reduce((a, b) => (endOf(b) < endOf(a) ? b : a));
    for (const returnDate of returnDates) {
      if (returnDate < departDate) continue;
      const nights = nightsBetween(departDate, returnDate);
      if (nights < minNights || nights > maxNights) continue;
      const ins = inbound[returnDate];
      if (!ins?.length) continue;
      const back = ins.reduce((a, b) =>
        hhmmToMinutes(b.departure) > hhmmToMinutes(a.departure) ? b : a,
      );
      // Même jour : le retour doit partir après l'arrivée de l'aller.
      if (nights === 0 && hhmmToMinutes(back.departure) <= endOf(best)) continue;
      trips.push({ departDate, returnDate, nights, outbound: best, back });
    }
  }

  return trips
    .sort((a, b) => a.departDate.localeCompare(b.departDate) || a.nights - b.nights)
    .slice(0, maxResults);
}

/** Arrivée absolue d'un trajet, en minutes depuis le début du jour de départ. */
const endOf = (j: Journey): number => hhmmToMinutes(j.departure) + j.totalMinutes;

/** Nombre de nuits entre deux dates ISO. */
export function nightsBetween(a: string, b: string): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86_400_000);
}

/** Les dates d'un intervalle ISO inclusif, bornées à `cap` jours. */
export function datesBetween(from: string, to: string, cap = 31): string[] {
  const out: string[] = [];
  let d = parseISO(from);
  const end = parseISO(to);
  while (d <= end && out.length < cap) {
    out.push(iso(d));
    d = addDays(d, 1);
  }
  return out;
}
