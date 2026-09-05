import type { Train } from "./models";
import { durationMinutes } from "./time";

/**
 * Deux façons de lire une journée de trains.
 *
 * L'ordre chronologique répond à « je pars vers 18 h » ; l'ordre par durée
 * répond à « je veux y être vite ». Sur un même trajet, l'écart va couramment
 * du simple au double : trois heures par la ligne à grande vitesse, sept en
 * passant par ailleurs. C'est une information que la liste portait déjà sans
 * jamais s'en servir.
 */
export type TrainSort = "departure" | "duration";

/** Durée d'un train, passage de minuit compris. */
export const tripMinutes = (t: Train): number => durationMinutes(t.departure, t.arrival);

/**
 * Trie une liste sans la modifier.
 *
 * À durée égale, le plus tôt d'abord : deux trains de trois heures se
 * départagent par leur heure de départ, jamais par leur ordre d'arrivée dans
 * la réponse de l'API.
 */
export function sortTrains(list: Train[], key: TrainSort): Train[] {
  const byDeparture = (a: Train, b: Train): number => a.departure.localeCompare(b.departure);
  if (key === "departure") return [...list].sort(byDeparture);
  return [...list].sort((a, b) => tripMinutes(a) - tripMinutes(b) || byDeparture(a, b));
}

/**
 * Le train le plus rapide de la liste, ou `null` si elle est vide. À égalité,
 * le plus matinal, pour désigner toujours le même.
 */
export function fastestTrain(list: Train[]): Train | null {
  return list.reduce<Train | null>((best, t) => {
    if (!best) return t;
    const d = tripMinutes(t) - tripMinutes(best);
    if (d < 0 || (d === 0 && t.departure < best.departure)) return t;
    return best;
  }, null);
}
