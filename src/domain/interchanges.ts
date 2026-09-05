/**
 * Gares qui n'en font qu'une sur le terrain.
 *
 * Le jeu de données nomme chaque gare séparément, et deux noms voisins de
 * quelques centaines de mètres désignent parfois le même échangeur : « MASSY
 * TGV » et « MASSY PALAISEAU » se rejoignent à pied. Le planificateur, lui, ne
 * raccorde deux trains que sur un nom identique. Sans ce regroupement, tout un
 * pan du réseau devient une île : Le Havre, par exemple, n'est desservi que par
 * le TGV province-Normandie, qui ne touche l'Île-de-France qu'à
 * Massy-Palaiseau. Aucun train MAX n'arrivant sous ce nom-là, la recherche
 * concluait « aucun itinéraire », alors qu'il suffit de traverser le parvis.
 */

/** Une gare située, telle que la porte le catalogue de gares. */
export interface GeoStation {
  name: string;
  lat: number;
  lon: number;
}

/** Distance en deçà de laquelle deux gares sont considérées comme mitoyennes. */
export const INTERCHANGE_KM = 1;

/**
 * Marche à pied ajoutée au temps de correspondance quand elle change de gare.
 *
 * Volontairement large pour un kilomètre au plus : le trajet se fait valise à
 * la main, et rater le second train coûte plus cher qu'attendre dix minutes.
 */
export const WALK_MINUTES = 10;

const EARTH_KM = 6371;
const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Distance orthodromique entre deux gares, en kilomètres. */
export function distanceKm(a: GeoStation, b: GeoStation): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

/**
 * Table « nom de gare → nom de l'échangeur », pour les seules gares qui en
 * rejoignent une autre.
 *
 * Le nom retenu pour l'échangeur est celui qui vient en premier dans la liste :
 * le catalogue étant rangé par trafic, c'est la gare la plus desservie qui
 * donne son nom. Les gares se relient de proche en proche, si bien qu'une file
 * de gares mitoyennes forme un seul échangeur même si les deux bouts sont plus
 * éloignés que la distance retenue.
 */
export function buildInterchanges(
  stations: GeoStation[],
  maxKm = INTERCHANGE_KM,
): Map<string, string> {
  const parent = stations.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) {
      parent[r] = parent[parent[r]];
      r = parent[r];
    }
    return r;
  };
  for (let i = 0; i < stations.length; i += 1) {
    for (let j = i + 1; j < stations.length; j += 1) {
      if (distanceKm(stations[i], stations[j]) > maxKm) continue;
      const a = find(i);
      const b = find(j);
      // Le plus petit indice l'emporte : le nom de l'échangeur est stable.
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
  }
  const hubs = new Map<string, string>();
  for (let i = 0; i < stations.length; i += 1) {
    const root = find(i);
    if (root !== i) hubs.set(stations[i].name, stations[root].name);
  }
  return hubs;
}
