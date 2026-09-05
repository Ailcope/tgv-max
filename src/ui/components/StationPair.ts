import type { StationRepository } from "@/data/StationRepository";
import { button, field } from "../dom";
import { StationPicker } from "./StationPicker";

export interface StationPairOptions {
  fromValue?: string;
  toValue?: string;
  fromPlaceholder?: string;
  toPlaceholder?: string;
  /** Appelée à chaque changement, quelle qu'en soit la cause. */
  onChange: () => void;
}

/**
 * Le couple départ / arrivée, avec son bouton d'inversion.
 *
 * Trois écrans posaient la même question, chacun avec ses deux sélecteurs, son
 * bouton et sa méthode `swap()` recopiée à l'identique, y compris le détour par
 * `clear()` avant de réaffecter les deux gares. Une correction sur la saisie
 * demandait donc trois corrections.
 *
 * Le composant rend ses éléments prêts à être posés dans un bandeau de
 * recherche, dans l'ordre attendu : départ, inversion, arrivée.
 */
export class StationPair {
  readonly from: StationPicker;
  readonly to: StationPicker;
  readonly nodes: HTMLElement[];

  constructor(
    stations: StationRepository,
    private readonly opts: StationPairOptions,
  ) {
    this.from = new StationPicker(stations, {
      placeholder: opts.fromPlaceholder ?? "ex. Paris",
      value: opts.fromValue,
      onSelect: () => opts.onChange(),
    });
    this.to = new StationPicker(stations, {
      placeholder: opts.toPlaceholder ?? "ex. Lyon",
      value: opts.toValue,
      onSelect: () => opts.onChange(),
    });
    const swap = button("⇄", "swap", () => this.swap());
    swap.title = "Inverser le départ et l'arrivée";
    swap.setAttribute("aria-label", "Inverser le départ et l'arrivée");
    this.nodes = [field("Départ", this.from.element), swap, field("Arrivée", this.to.element)];
  }

  get fromValue(): string | null {
    return this.from.value;
  }

  get toValue(): string | null {
    return this.to.value;
  }

  /** Renseigne le couple sans prévenir personne (chargement d'un lien, palette). */
  set(from?: string, to?: string): void {
    if (from) this.from.set(from);
    if (to) this.to.set(to);
  }

  /**
   * Échange les deux gares.
   *
   * Le passage par `clear()` n'est pas une précaution inutile : `set()` ne fait
   * rien pour une gare inconnue du catalogue, et sans vidage préalable
   * l'ancienne valeur resterait affichée.
   */
  swap(): void {
    const a = this.from.value;
    const b = this.to.value;
    this.from.clear();
    this.to.clear();
    if (b) this.from.set(b);
    if (a) this.to.set(a);
    this.opts.onChange();
  }
}
