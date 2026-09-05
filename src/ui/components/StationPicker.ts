import type { StationRepository } from "@/data/StationRepository";
import type { Station } from "@/domain/models";
import { recentStations, rememberStation } from "@/lib/recent";
import { prettyStation } from "@/lib/text";
import { clear, el } from "../dom";
import { flag } from "./flags";

export interface StationPickerOptions {
  placeholder?: string;
  /** Initial station, selected silently (does not fire `onSelect`). */
  value?: string;
  onSelect?: (station: Station) => void;
}

/**
 * Searchable station selector with keyboard navigation.
 * Search/lookup is delegated to {@link StationRepository}; this class is
 * purely presentational. Initial values are set silently, so views can set
 * defaults then trigger their first load explicitly (no init-order hacks).
 */
export class StationPicker {
  readonly element: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly menu: HTMLElement;
  private results: Station[] = [];
  /** Les lignes cliquables du menu, intitulés de section exclus. */
  private rows: HTMLElement[] = [];
  private active = -1;
  private selected: Station | null = null;

  constructor(
    private readonly repo: StationRepository,
    private readonly opts: StationPickerOptions = {},
  ) {
    this.input = el("input", {
      class: "picker-input",
      type: "text",
      placeholder: opts.placeholder ?? "Gare…",
      autocomplete: "off",
      spellcheck: "false",
    });
    this.menu = el("div", { class: "picker-menu hidden" });
    this.element = el("div", { class: "picker" }, [this.input, this.menu]);
    this.wire();
    if (opts.value) this.set(opts.value);
  }

  /** Raw SNCF name of the selected station (for API queries), or `null`. */
  get value(): string | null {
    return this.selected?.name ?? null;
  }

  get station(): Station | null {
    return this.selected;
  }

  /** Select a station by name without firing `onSelect`. */
  set(name: string): void {
    const s = this.repo.get(name);
    if (s) {
      this.selected = s;
      this.input.value = prettyStation(s.name);
    }
  }

  clear(): void {
    this.selected = null;
    this.input.value = "";
  }

  private choose(s: Station): void {
    this.selected = s;
    this.input.value = prettyStation(s.name);
    this.menu.classList.add("hidden");
    rememberStation(s.name);
    this.opts.onSelect?.(s);
  }

  /**
   * Ce que propose le menu selon ce qui est saisi.
   *
   * Champ vide, le catalogue commence par les gares les plus fréquentées, ce
   * qui ne dit rien de la personne devant l'écran. Ses dernières gares
   * passent donc devant : c'est presque toujours l'une d'elles qu'elle
   * cherche. Dès qu'elle tape, la recherche reprend ses droits.
   */
  private suggest(): void {
    const found = this.repo.search(this.input.value);
    if (this.input.value.trim()) {
      this.render(found);
      return;
    }
    const recent = recentStations()
      .map((name) => this.repo.get(name))
      .filter((s): s is Station => Boolean(s));
    this.render(
      found.filter((s) => !recent.some((r) => r.name === s.name)),
      recent,
    );
  }

  private render(list: Station[], recent: Station[] = []): void {
    // Les récentes d'abord : la navigation au clavier suit ce même ordre.
    this.results = [...recent, ...list];
    this.rows = [];
    this.active = -1;
    clear(this.menu);
    if (!this.results.length) {
      this.menu.classList.add("hidden");
      return;
    }
    if (recent.length) this.menu.appendChild(el("div", { class: "picker-head", text: "Récentes" }));
    recent.forEach((s) => this.addRow(s));
    if (recent.length && list.length) {
      this.menu.appendChild(el("div", { class: "picker-head", text: "Autres gares" }));
    }
    list.forEach((s) => this.addRow(s));
    this.menu.classList.remove("hidden");
  }

  /** Ajoute une ligne de gare et l'enregistre pour la navigation au clavier. */
  private addRow(s: Station): void {
    const i = this.rows.length;
    const row = el("div", { class: "picker-opt" }, [
      el("span", { class: "po-name", text: prettyStation(s.name) }),
      el("span", { class: "po-flag", text: flag(s.country) }),
    ]);
    row.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.choose(s);
    });
    row.addEventListener("mouseenter", () => this.setActive(i));
    this.rows.push(row);
    this.menu.appendChild(row);
  }

  private setActive(i: number): void {
    this.active = i;
    // Les intitulés de section sont des enfants du menu sans être des lignes :
    // la surbrillance se règle sur les lignes, pas sur la position dans le DOM.
    this.rows.forEach((row, j) => row.classList.toggle("active", j === i));
    this.rows[i]?.scrollIntoView({ block: "nearest" });
  }

  /** Resolve free text on blur: exact match, else best prefix match, else nothing. */
  private commitFree(): void {
    const raw = this.input.value.trim();
    if (!raw) {
      this.selected = null;
      return;
    }
    if (this.selected && prettyStation(this.selected.name) === this.input.value) return;
    const exact = this.repo.get(raw);
    if (exact) {
      this.choose(exact);
      return;
    }
    const first = this.results[0];
    if (first) this.choose(first);
    else this.selected = null;
  }

  private wire(): void {
    this.input.addEventListener("input", () => {
      this.selected = null;
      this.suggest();
    });
    this.input.addEventListener("focus", () => this.suggest());
    this.input.addEventListener("blur", () =>
      setTimeout(() => {
        this.commitFree();
        this.menu.classList.add("hidden");
      }, 120),
    );
    this.input.addEventListener("keydown", (e) => {
      if (this.menu.classList.contains("hidden")) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        this.setActive(Math.min(this.active + 1, this.results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        this.setActive(Math.max(this.active - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const s = this.results[this.active];
        if (s) this.choose(s);
        else this.commitFree();
      } else if (e.key === "Escape") {
        this.menu.classList.add("hidden");
      }
    });
  }
}
