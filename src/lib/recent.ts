/**
 * Les dernières gares choisies.
 *
 * Une recherche de places MAX se rejoue : on regarde le même trajet plusieurs
 * jours de suite, ou on compare deux destinations. Retaper le nom de la gare à
 * chaque fois, dans chaque onglet, est le geste le plus répété du site.
 *
 * Comme les autres réglages d'affichage, la liste vit dans le navigateur du
 * visiteur (voir `prefs.ts`) et n'est jamais transmise ailleurs.
 */
import { pref, setPref } from "./prefs";

const KEY = "gares.recentes";

/** Au-delà, la liste cesse d'être un raccourci pour devenir un annuaire. */
export const MAX_RECENT = 6;

/**
 * La liste mise à jour : la gare passe en tête, sans doublon, et la plus
 * ancienne sort quand la liste déborde. Pure, pour être éprouvée sans
 * navigateur.
 */
export function pushRecent(list: readonly string[], name: string, max = MAX_RECENT): string[] {
  if (!name) return [...list];
  return [name, ...list.filter((n) => n !== name)].slice(0, max);
}

/** Les gares retenues, de la plus récente à la plus ancienne. */
export function recentStations(): string[] {
  try {
    const parsed: unknown = JSON.parse(pref(KEY, "[]"));
    // Un contenu abîmé ne doit pas priver le champ de son menu.
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === "string") : [];
  } catch {
    return [];
  }
}

/** Retient une gare choisie. */
export function rememberStation(name: string): void {
  setPref(KEY, JSON.stringify(pushRecent(recentStations(), name)));
}
