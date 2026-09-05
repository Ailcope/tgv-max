import type { StationRepository } from "@/data/StationRepository";
import type { TgvmaxRepository } from "@/data/TgvmaxRepository";
import { heatLevel } from "@/domain/availability";
import { buildHeatmap, countStations, heatDates, heatPeak, type HeatRow } from "@/domain/heatmap";
import { DOWS, frDateLong, isWeekend, parseISO } from "@/lib/dates";
import { prettyStation } from "@/lib/text";
import { StationPicker } from "../components/StationPicker";
import { empty, errorState, hint, loading } from "../components/states";
import { clear, el, field, select } from "../dom";
import type { View } from "./View";

/** Nombre de gares affichées : au-delà, le tableau devient un annuaire. */
const ROWS = 40;

type Mode = "from" | "to";

/**
 * « Carte de chaleur » : toutes les destinations d'une gare, croisées avec les
 * jours à venir.
 *
 * Le calendrier répond à « quand aller à Lyon ? » et suppose la destination
 * connue. La carte répond à « où aller demain ? » et suppose la date connue.
 * Quand ni l'une ni l'autre n'est fixée, il fallait ouvrir trente calendriers
 * pour s'en sortir. Ce tableau donne la réponse d'un coup d'œil : les lignes
 * sont les gares, les colonnes les jours, et la couleur dit où regarder.
 */
export class HeatmapView implements View {
  readonly id = "heatmap";
  readonly label = "Carte de chaleur";
  readonly emoji = "🔥";
  readonly hint = "où et quand, d'un coup d'œil";
  readonly element: HTMLElement;

  /**
   * Appelée au clic sur une case, pour passer la main au calendrier. Câblée
   * après coup par la racine de composition : la vue n'a pas à connaître
   * l'application qui la contient.
   */
  onPick?: (origin: string, destination: string) => void;

  private readonly picker: StationPicker;
  private readonly modeSelect: HTMLSelectElement;
  private readonly windowSelect: HTMLSelectElement;
  private readonly stationLabel = el("span", { class: "f-lab", text: "Départ" });
  private readonly summary = el("div", { class: "summary" });
  private readonly out = el("div", { class: "hm-scroll" });
  private loaded = false;

  constructor(
    private readonly repo: TgvmaxRepository,
    stations: StationRepository,
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
        this.stationLabel.textContent = this.mode() === "to" ? "Arrivée" : "Départ";
        void this.run();
      },
    );
    this.windowSelect = select(
      [
        ["14", "14 jours"],
        ["30", "30 jours"],
      ],
      () => void this.run(),
    );
    this.windowSelect.value = "30";

    const stationField = el("label", { class: "f" }, [this.stationLabel, this.picker.element]);
    const controls = el("div", { class: "controls" }, [
      field("Mode", this.modeSelect),
      stationField,
      field("Fenêtre", this.windowSelect),
      el("button", { class: "btn-primary", text: "Afficher", onclick: () => void this.run() }),
    ]);
    this.element = el("section", { class: "panel" }, [
      controls,
      hint(
        "Une ligne par gare, une colonne par jour : plus le vert est franc, plus il reste de trains MAX ce jour-là. Le trait bleu marque les samedis et dimanches. Cliquez une case pour ouvrir le calendrier du trajet.",
      ),
      this.summary,
      this.out,
    ]);
  }

  activate(): void {
    if (!this.loaded) void this.run();
  }

  /** Pre-fill from the command palette. */
  preset(origin: string): void {
    this.modeSelect.value = "from";
    this.stationLabel.textContent = "Départ";
    this.picker.set(origin);
    void this.run();
  }

  private mode(): Mode {
    return this.modeSelect.value as Mode;
  }

  private async run(): Promise<void> {
    const station = this.picker.value;
    if (!station) {
      empty(this.summary, "Choisissez une gare.");
      clear(this.out);
      return;
    }
    loading(this.out, "Comptage des places, jour par jour et gare par gare…");
    clear(this.summary);
    try {
      const counts = await this.repo.countsByStationAndDate(station, this.mode());
      if (this.picker.value !== station) return; // la gare a changé pendant l'attente
      const dates = heatDates(Number(this.windowSelect.value));
      this.loaded = true;
      this.render(station, dates, buildHeatmap(counts, dates, ROWS), countStations(counts, dates));
    } catch (e) {
      errorState(this.out, (e as Error).message);
    }
  }

  private render(station: string, dates: string[], rows: HeatRow[], served: number): void {
    const to = this.mode() === "to";
    const trains = rows.reduce((sum, r) => sum + r.total, 0);
    // Le tableau s'arrête à quarante lignes : quand il en existe davantage, on
    // le dit, sinon « 40 gares » se lit comme le total.
    const shown =
      served > rows.length
        ? `les <span class="ok">${rows.length} gares</span> les mieux desservies parmi ${served}`
        : `<span class="ok">${rows.length} gare${rows.length > 1 ? "s" : ""}</span>`;
    clear(this.summary).appendChild(
      el("div", {
        class: "sum-line",
        html: rows.length
          ? `${to ? "Vers" : "Depuis"} <b>${prettyStation(station)}</b> · ${shown} · ` +
            `${dates.length} jours · ${trains} trajet${trains > 1 ? "s" : ""} avec place MAX`
          : `${to ? "Vers" : "Depuis"} <b>${prettyStation(station)}</b> · ` +
            `<span class="ko">aucune place MAX</span> sur la fenêtre`,
      }),
    );

    clear(this.out);
    if (!rows.length) {
      empty(this.out, "Rien sur cette fenêtre. Essayez l'autre sens, ou une gare plus desservie.");
      return;
    }

    const grid = el("div", { class: "hm" });
    grid.style.setProperty("--hm-cols", String(dates.length));
    grid.appendChild(this.headRow(dates));
    for (const row of rows) grid.appendChild(this.row(station, row, dates));
    this.out.appendChild(grid);
    this.out.appendChild(this.legend(heatPeak(rows)));
  }

  private headRow(dates: string[]): HTMLElement {
    return el("div", { class: "hm-row hm-head" }, [
      el("span", { class: "hm-lab" }),
      ...dates.map((d) => {
        const day = parseISO(d);
        return el(
          "span",
          { class: `hm-day${isWeekend(d) ? " hm-we" : ""}`, title: frDateLong(d) },
          [
            el("b", { text: String(day.getDate()) }),
            el("small", { text: DOWS[day.getDay()].slice(0, 1) }),
          ],
        );
      }),
    ]);
  }

  private row(station: string, row: HeatRow, dates: string[]): HTMLElement {
    const to = this.mode() === "to";
    const label = el(
      "span",
      { class: "hm-lab", title: `${row.total} trajet(s) sur ${row.days} jour(s)` },
      [
        el("span", { class: "hm-name", text: prettyStation(row.station) }),
        el("span", { class: "hm-total", text: String(row.total) }),
      ],
    );
    const cells = dates.map((d) => {
      const n = row.byDate[d] ?? 0;
      const cell = el("span", {
        class: `hm-cell lvl${heatLevel(n)}${isWeekend(d) ? " hm-we" : ""}${n ? " hm-has" : ""}`,
        text: n ? String(n) : "",
        title: n
          ? `${prettyStation(row.station)} · ${frDateLong(d)} · ${n} trajet(s) MAX`
          : `${prettyStation(row.station)} · ${frDateLong(d)} · aucune place`,
      });
      if (n) {
        cell.addEventListener("click", () => {
          const [origin, destination] = to ? [row.station, station] : [station, row.station];
          this.onPick?.(origin, destination);
        });
      }
      return cell;
    });
    return el("div", { class: "hm-row" }, [label, ...cells]);
  }

  /** Légende : les mêmes paliers que le calendrier, plus le pic du tableau. */
  private legend(peak: number): HTMLElement {
    const items: [string, string][] = [
      ["0", "lvl0"],
      ["1 à 2", "lvl1"],
      ["3 à 5", "lvl2"],
      ["6 à 9", "lvl3"],
      ["10 et plus", "lvl4"],
    ];
    const lg = el("div", { class: "legend" }, [
      el("span", { class: "lg-lab", text: "Trajets par jour :" }),
    ]);
    for (const [text, cls] of items) {
      lg.appendChild(
        el("span", { class: "lg-item" }, [
          el("span", { class: `lg-sw ${cls}` }),
          el("span", { text }),
        ]),
      );
    }
    if (peak) lg.appendChild(el("span", { class: "lg-peak", text: `pic : ${peak} le même jour` }));
    return lg;
  }
}
