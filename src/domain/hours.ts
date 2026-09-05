import type { Train } from "./models";
import { hhmmToMinutes } from "./time";

/**
 * Une plage horaire de voyage : ne pas partir avant, être arrivé avant.
 *
 * `0` vaut « pas de borne » des deux côtés : c'est la valeur par défaut, et
 * elle laisse tout passer.
 */
export interface HourWindow {
  /** Minutes depuis minuit ; le départ ne doit pas être antérieur. */
  after: number;
  /** Minutes depuis minuit ; l'arrivée ne doit pas être postérieure. */
  before: number;
}

export const ANY_HOUR: HourWindow = { after: 0, before: 0 };

/** Vrai quand aucune borne n'est posée : inutile de filtrer quoi que ce soit. */
export function isOpen(w: HourWindow): boolean {
  return !w.after && !w.before;
}

/**
 * Un trajet tient-il dans la plage ?
 *
 * `nextDay` change tout pour la borne d'arrivée : un train de nuit arrivé à
 * 06:15 arrive après 22:00, pas avant. Comparer les seuls quantièmes le ferait
 * passer pour le trajet le plus matinal de la liste.
 */
export function withinHours(
  departure: string,
  arrival: string,
  nextDay: boolean,
  w: HourWindow,
): boolean {
  if (isOpen(w)) return true;
  if (w.after && hhmmToMinutes(departure) < w.after) return false;
  if (!w.before) return true;
  return hhmmToMinutes(arrival) + (nextDay ? 24 * 60 : 0) <= w.before;
}

/** Le même test pour un train du jeu de données. */
export function trainWithinHours(t: Train, w: HourWindow): boolean {
  return withinHours(t.departure, t.arrival, t.arrival < t.departure, w);
}
