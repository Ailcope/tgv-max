import type { StationRepository } from "@/data/StationRepository";
import type { TgvmaxRepository } from "@/data/TgvmaxRepository";
import type { DestinationAvailability, OriginAvailability, Train } from "@/domain/models";
import { formatDuration } from "@/domain/time";
import { addDays, frDateLong, iso, nextSaturday, today } from "@/lib/dates";
import { formatRidership } from "@/lib/format";
import { prettyStation } from "@/lib/text";
import { flag } from "../components/flags";
import { StationPicker } from "../components/StationPicker";
import { empty, errorState, loading } from "../components/states";
import { reserveButton, trainRow } from "../components/trains";
import { button, clear, el, field, select } from "../dom";
import type { View } from "./View";

type SortKey = "trains" | "dur" | "pop" | "confid" | "abc";
type Mode = "from" | "to";

interface GroupedStation {
  name: string;
  trains: number;
  firstDeparture: string;
  fastestMinutes: number;
  list: Train[];
}

/**
 * Toutes les destinations avec une place MAX depuis une gare, ou, en mode
 * « Vers une gare », tous les départs qui mènent à une gare choisie.
 */
export class DestinationsView implements View {
  readonly id = "destinations";
  readonly label = "Où aller ?";
  readonly emoji = "🧭";
  readonly hint = "destinations & départs";
  readonly element: HTMLElement;

  private readonly picker: StationPicker;
  private readonly modeSelect: HTMLSelectElement;
  private readonly stationFieldLabel: HTMLSpanElement;
  private readonly dateInput: HTMLInputElement;
  private readonly sortSelect: HTMLSelectElement;
  private readonly durSelect: HTMLSelectElement;
  private readonly summary = el("div", { class: "summary" });
  private readonly out = el("div", { class: "dest-grid" });
  private results: GroupedStation[] = [];
  private loaded = false;

  constructor(
    private readonly repo: TgvmaxRepository,
    private readonly stations: StationRepository,
  ) {
    this.picker = new StationPicker(stations, {
      placeholder: "ex. Paris",
      value: "PARIS (intramuros)",
      onSelect: () => void this.run(),
    });
    this.modeSelect = select(
      [
        ["from", "Depuis une gare"],
        ["to", "Vers une gare"],
      ],
      () => {
        this.stationFieldLabel.textContent = this.mode() === "to" ? "Arrivée" : "Départ";
        void this.run();
      },
    );
    this.dateInput = el("input", {
      class: "date-input",
      type: "date",
      min: iso(today()),
      value: iso(nextSaturday()),
    });
    this.dateInput.addEventListener("change", () => void this.run());
    this.durSelect = select(
      [
        ["0", "Toute durée"],
        ["120", "≤ 2h"],
        ["180", "≤ 3h"],
        ["240", "≤ 4h"],
        ["360", "≤ 6h"],
      ],
      () => this.render(),
    );
    this.sortSelect = select(
      [
        ["trains", "Plus de trains"],
        ["dur", "Trajet le plus court"],
        ["pop", "Les plus fréquentées"],
        ["confid", "Les plus confidentielles"],
        ["abc", "A → Z"],
      ],
      () => this.render(),
    );

    this.stationFieldLabel = el("span", { class: "f-lab", text: "Départ" });
    const stationField = el("label", { class: "f" }, [this.stationFieldLabel, this.picker.element]);
    const controls = el("div", { class: "controls" }, [
      field("Mode", this.modeSelect),
      stationField,
      field("Date", this.dateInput),
      field("Trajet max", this.durSelect),
      field("Trier par", this.sortSelect),
      button("Chercher", "btn-primary", () => void this.run()),
    ]);
    const chips = el("div", { class: "chips" }, [
      button("Aujourd'hui", "chip", () => this.setDate(today())),
      button("Demain", "chip", () => this.setDate(addDays(today(), 1))),
      button("Ce week-end", "chip", () => this.setDate(nextSaturday())),
      button("🎲 Surprends-moi", "chip chip-accent", () => this.surprise()),
    ]);
    this.element = el("section", { class: "panel" }, [controls, chips, this.summary, this.out]);
  }

  activate(): void {
    if (!this.loaded) void this.run();
  }

  /** Pre-fill from the command palette. */
  preset(origin: string, destination?: string): void {
    this.picker.set(destination ?? origin);
    if (destination) {
      this.modeSelect.value = "to";
      this.stationFieldLabel.textContent = "Arrivée";
    }
    void this.run();
  }

  private mode(): Mode {
    return this.modeSelect.value as Mode;
  }

  private setDate(d: Date): void {
    this.dateInput.value = iso(d);
    void this.run();
  }

  private async run(): Promise<void> {
    const station = this.picker.value;
    const date = this.dateInput.value;
    if (!station || !date) {
      empty(this.summary, "Choisissez une gare et une date.");
      clear(this.out);
      return;
    }
    loading(this.out, this.mode() === "to" ? "Recherche des départs vers cette ville…" : "Recherche des destinations…");
    clear(this.summary);
    try {
      const grouped =
        this.mode() === "to"
          ? ((await this.repo.originsOn(station, date)) as OriginAvailability[])
          : ((await this.repo.destinationsOn(station, date)) as DestinationAvailability[]);
      this.results = grouped.map((r) => ({
        name: "origin" in r ? r.origin : r.destination,
        trains: r.trains,
        firstDeparture: r.firstDeparture,
        fastestMinutes: r.fastestMinutes,
        list: r.list,
      }));
      this.loaded = true;
      this.render();
    } catch (e) {
      errorState(this.out, (e as Error).message);
    }
  }

  private filtered(): GroupedStation[] {
    const maxDur = Number(this.durSelect.value);
    const list = this.results.filter((r) => !maxDur || r.fastestMinutes <= maxDur);
    const key = this.sortSelect.value as SortKey;
    const freq = (name: string): number => this.stations.get(name)?.ridership ?? 0;
    const comparators: Record<SortKey, (a: GroupedStation, b: GroupedStation) => number> = {
      abc: (a, b) => prettyStation(a.name).localeCompare(prettyStation(b.name)),
      dur: (a, b) => a.fastestMinutes - b.fastestMinutes,
      pop: (a, b) => freq(b.name) - freq(a.name),
      confid: (a, b) => (freq(a.name) || Infinity) - (freq(b.name) || Infinity),
      trains: (a, b) => b.trains - a.trains,
    };
    return [...list].sort(comparators[key]);
  }

  private render(): void {
    const station = this.picker.value;
    const date = this.dateInput.value;
    if (!station) return;
    const res = this.filtered();
    const to = this.mode() === "to";
    const noun = to ? "gare de départ" : "destination";

    clear(this.summary).appendChild(
      el("div", {
        class: "sum-line",
        html: `<b>${res.length}</b> ${noun}${res.length > 1 ? "s" : ""} accessible${res.length > 1 ? "s" : ""} avec une place MAX ${to ? "vers" : "depuis"} <b>${prettyStation(station)}</b> · ${frDateLong(date)}`,
      }),
    );

    clear(this.out);
    if (!res.length) {
      empty(this.out, "Aucune place MAX ce jour-là. Essayez une autre date.");
      return;
    }
    for (const r of res) this.out.appendChild(this.card(r));
  }

  private card(r: GroupedStation): HTMLElement {
    const station = this.stations.get(r.name);
    const ridership = station?.ridership ?? 0;
    const body = el("div", { class: "dc-body hidden" });
    let filled = false;
    const card = el("div", { class: "dest-card", "data-dest": r.name }, [
      el("div", { class: "dc-head" }, [
        el("div", { class: "dc-title" }, [
          el("span", { class: "dc-flag", text: flag(station?.country ?? "FR") }),
          el("span", { class: "dc-name", text: prettyStation(r.name) }),
        ]),
        el("div", { class: "dc-meta" }, [
          el("span", { class: "dc-badge", text: `${r.trains} trajet${r.trains > 1 ? "s" : ""}` }),
          el("span", {
            class: "dc-dur",
            text: `dès ${r.firstDeparture} · ${formatDuration(r.fastestMinutes)}`,
          }),
          ridership
            ? el("span", { class: "dc-freq", text: `👥 ${formatRidership(ridership)} voy./an` })
            : null,
        ]),
      ]),
      body,
    ]);
    card.querySelector(".dc-head")?.addEventListener("click", () => {
      card.classList.toggle("open");
      if (body.classList.contains("hidden")) {
        body.classList.remove("hidden");
        if (!filled) {
          filled = true;
          [...r.list]
            .sort((a, b) => a.departure.localeCompare(b.departure))
            .forEach((t) => body.appendChild(trainRow(t)));
          body.appendChild(reserveButton("Réserver ce trajet ↗"));
        }
      } else {
        body.classList.add("hidden");
      }
    });
    return card;
  }

  private surprise(): void {
    const pool = this.filtered();
    if (!pool.length) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    const selector = `[data-dest="${window.CSS && CSS.escape ? CSS.escape(pick.name) : pick.name}"]`;
    const node = this.out.querySelector(selector);
    if (node) {
      this.out.querySelectorAll(".flash").forEach((n) => n.classList.remove("flash"));
      node.classList.add("flash");
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
}