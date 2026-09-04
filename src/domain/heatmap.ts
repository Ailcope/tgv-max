/**
 * Carte de chaleur : une gare par ligne, un jour par colonne.
 *
 * Le calendrier répond à « quand puis-je aller à Lyon ? », la carte à « où
 * puis-je aller demain ? ». Il manquait le croisement des deux, qui est
 * pourtant la question qu'on se pose vraiment quand la destination n'est pas
 * imposée : quelque part, dans les trois prochaines semaines, où reste-t-il
 * de la place.
 *
 * Tout ce qui suit est pur : le tableau se calcule à partir des comptages
 * agrégés renvoyés par l'API, sans rien connaître du DOM.
 */

import { addDays, iso, today } from "@/lib/dates";

/** Un comptage brut : une gare, une date, le nombre de trains MAX ce jour-là. */
export interface StationDateCount {
  station: string;
  /** `"YYYY-MM-DD"`. */
  date: string;
  trains: number;
}

/** Une ligne du tableau : une gare, et son compte jour par jour. */
export interface HeatRow {
  station: string;
  /** Trains MAX sur toute la fenêtre. */
  total: number;
  /** Nombre de jours où il reste au moins un train. */
  days: number;
  /** Le jour le mieux desservi ; `""` quand la ligne est vide. */
  bestDate: string;
  /** `"YYYY-MM-DD"` → nombre de trains. */
  byDate: Record<string, number>;
}

/**
 * Les `days` dates de la fenêtre, à partir d'aujourd'hui.
 * La date de départ est injectable pour que les tests ne dépendent pas du jour.
 */
export function heatDates(days: number, from: Date = today()): string[] {
  return Array.from({ length: Math.max(0, days) }, (_, i) => iso(addDays(from, i)));
}

/**
 * Regroupe les comptages en une ligne par gare, de la mieux desservie à la
 * moins bien.
 *
 * Les comptages hors fenêtre sont ignorés plutôt que repliés sur un bord : une
 * ligne doit se lire colonne par colonne, et un total qui ne correspond à
 * aucune case visible ne serait pas vérifiable à l'œil.
 *
 * `limit` coupe la queue de distribution. Depuis Paris le dataset donne plus de
 * deux cents destinations, dont la plupart avec un seul train sur le mois :
 * au-delà d'une quarantaine de lignes on ne lit plus un tableau, on fait
 * défiler un annuaire.
 */
export function buildHeatmap(counts: StationDateCount[], dates: string[], limit = 40): HeatRow[] {
  const window = new Set(dates);
  const rows = new Map<string, HeatRow>();
  for (const c of counts) {
    if (!window.has(c.date) || c.trains <= 0) continue;
    let row = rows.get(c.station);
    if (!row) {
      row = { station: c.station, total: 0, days: 0, bestDate: "", byDate: {} };
      rows.set(c.station, row);
    }
    // Une même gare peut revenir plusieurs fois pour une date (un libellé qui
    // couvre plusieurs gares physiques) : on additionne au lieu d'écraser.
    row.byDate[c.date] = (row.byDate[c.date] ?? 0) + c.trains;
    row.total += c.trains;
  }
  for (const row of rows.values()) {
    const days = Object.keys(row.byDate).sort();
    row.days = days.length;
    // À égalité, le jour le plus proche gagne : c'est celui qu'on peut encore
    // réserver tranquillement.
    row.bestDate = days.reduce(
      (best, d) => (row.byDate[d] > (row.byDate[best] ?? 0) ? d : best),
      "",
    );
  }
  return [...rows.values()]
    .sort((a, b) => b.total - a.total || a.station.localeCompare(b.station, "fr"))
    .slice(0, limit);
}

/** Le plus gros compte du tableau, qui sert d'échelle à la légende. */
export function heatPeak(rows: HeatRow[]): number {
  let peak = 0;
  for (const row of rows) {
    for (const date of Object.keys(row.byDate)) peak = Math.max(peak, row.byDate[date]);
  }
  return peak;
}
