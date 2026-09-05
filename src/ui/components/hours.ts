import type { HourWindow } from "@/domain/hours";
import { pref, setPref } from "@/lib/prefs";
import { field, select } from "../dom";

const AFTER_KEY = "heures.depart";
const BEFORE_KEY = "heures.arrivee";

/** Toutes les deux heures : assez fin pour cadrer un voyage, assez court pour un menu. */
function slots(label: string, from: number, to: number): [value: string, label: string][] {
  const list: [string, string][] = [["0", label]];
  for (let h = from; h <= to; h += 2)
    list.push([String(h * 60), `${String(h).padStart(2, "0")}:00`]);
  return list;
}

const AFTER = slots("Peu importe", 4, 22);
const BEFORE = slots("Peu importe", 8, 24);

/**
 * Le filtre horaire, partagé par tous les écrans.
 *
 * Un même voyageur a les mêmes contraintes partout : un cours jusqu'à midi, un
 * dernier métro à minuit. Régler l'heure dans le calendrier puis la régler de
 * nouveau dans les correspondances, c'est répondre deux fois à la même
 * question. Le réglage est donc unique, retenu comme les autres options, et
 * les écrans se contentent de s'y abonner.
 */
class HourFilter {
  private current: HourWindow = {
    after: Number(
      pref(
        AFTER_KEY,
        "0",
        AFTER.map(([v]) => v),
      ),
    ),
    before: Number(
      pref(
        BEFORE_KEY,
        "0",
        BEFORE.map(([v]) => v),
      ),
    ),
  };
  private readonly listeners = new Set<() => void>();

  get value(): HourWindow {
    return this.current;
  }

  /** Change une borne, la retient, et prévient les écrans ouverts. */
  set(part: Partial<HourWindow>): void {
    this.current = { ...this.current, ...part };
    if (part.after !== undefined) setPref(AFTER_KEY, String(part.after));
    if (part.before !== undefined) setPref(BEFORE_KEY, String(part.before));
    for (const fn of this.listeners) fn();
  }

  /** Un écran qui veut se redessiner quand la plage change. */
  subscribe(fn: () => void): void {
    this.listeners.add(fn);
  }
}

export const hourFilter = new HourFilter();

/**
 * Les deux champs à poser dans un bandeau de recherche. Ils reflètent le
 * réglage partagé, quel que soit l'écran qui l'a modifié en dernier.
 */
export function hourFields(): HTMLElement[] {
  const after = select(AFTER, () => hourFilter.set({ after: Number(after.value) }));
  const before = select(BEFORE, () => hourFilter.set({ before: Number(before.value) }));
  after.value = String(hourFilter.value.after);
  before.value = String(hourFilter.value.before);
  hourFilter.subscribe(() => {
    after.value = String(hourFilter.value.after);
    before.value = String(hourFilter.value.before);
  });
  return [field("Pas avant", after), field("Arrivée avant", before)];
}

/** Ce qu'affiche un écran quand la plage écarte des trajets. */
export function hoursNote(hidden: number): string {
  if (!hidden) return "";
  return ` · ${hidden} écarté${hidden > 1 ? "s" : ""} par la plage horaire`;
}
