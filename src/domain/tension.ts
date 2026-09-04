/**
 * Lecture du nombre de places restantes : à partir de quand faut-il se dépêcher ?
 *
 * Les seuils viennent de l'observation du service officiel sur des O/D très
 * fréquentés : un train ouvert au MAX affiche couramment 20 à 60 places, et les
 * trains à moins de cinq places sont pleins en quelques heures. On raisonne sur
 * le train le plus juste, pas sur le total de la journée : 300 places réparties
 * sur douze trains ne consolent pas si celui de 18 h en a deux.
 */

import type { DaySeats } from "./models";

export type TensionLevel = "unknown" | "calm" | "watch" | "tight" | "critical";

/** Seuils en nombre de places sur un seul train. */
export const TENSION_THRESHOLDS = { critical: 5, tight: 15, watch: 40 } as const;

/** Niveau de tension d'un train donné son nombre de places restantes. */
export function tensionOf(seats: number | undefined): TensionLevel {
  if (seats === undefined || !Number.isFinite(seats)) return "unknown";
  if (seats <= 0) return "critical";
  if (seats <= TENSION_THRESHOLDS.critical) return "critical";
  if (seats <= TENSION_THRESHOLDS.tight) return "tight";
  if (seats <= TENSION_THRESHOLDS.watch) return "watch";
  return "calm";
}

/**
 * Tension d'un trajet à plusieurs trains : c'est le maillon faible qui décide.
 * Un aller-retour ou une correspondance ne vaut que si **chaque** train a
 * encore une place : la jambe la plus juste donne donc le niveau, et une jambe
 * dont on ignore le compte rend l'ensemble inconnu plutôt que rassurant.
 */
export function tensionOfLegs(seatsPerLeg: Array<number | undefined>): TensionLevel {
  if (!seatsPerLeg.length) return "unknown";
  if (seatsPerLeg.some((s) => s === undefined)) return "unknown";
  return tensionOf(Math.min(...(seatsPerLeg as number[])));
}

/** Places du maillon faible, ou `undefined` si une jambe est inconnue. */
export function weakestLeg(seatsPerLeg: Array<number | undefined>): number | undefined {
  if (!seatsPerLeg.length || seatsPerLeg.some((s) => s === undefined)) return undefined;
  return Math.min(...(seatsPerLeg as number[]));
}

/** Faut-il alerter visuellement ? Seuls `tight` et `critical` méritent le rouge. */
export const isAlarming = (level: TensionLevel): boolean =>
  level === "tight" || level === "critical";

/** Phrase affichée dans le bandeau d'alerte. */
export function tensionMessage(level: TensionLevel, seats: number, legs = 1): string {
  const place = seats > 1 ? `${seats} places` : `${seats} place`;
  const ou = legs > 1 ? " sur l'un des trains" : "";
  if (level === "critical") {
    return seats <= 0
      ? "Plus aucune place MAX sur ce trajet, il ne reste que le tarif normal."
      : `Il ne reste que ${place}${ou} : à ce niveau, ça part dans la journée.`;
  }
  if (level === "tight") {
    return `Plus que ${place}${ou} : réservez maintenant si ce trajet vous intéresse.`;
  }
  return `${place} restantes${ou}.`;
}

/** Agrège les propositions d'une journée en un {@link DaySeats}. */
export function summarizeDay(
  date: string,
  proposals: Array<{ num: string; count: number }>,
  ratio: number,
): DaySeats {
  const byTrain: Record<string, number> = {};
  let seats = 0;
  for (const p of proposals) {
    // Un même numéro peut revenir (places assises et couchettes) : on cumule.
    byTrain[p.num] = (byTrain[p.num] ?? 0) + p.count;
    seats += p.count;
  }
  const counts = Object.values(byTrain);
  return {
    date,
    seats,
    trains: counts.length,
    minSeats: counts.length ? Math.min(...counts) : 0,
    ratio,
    byTrain,
  };
}
