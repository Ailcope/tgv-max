import type { TgvmaxRepository } from "@/data/TgvmaxRepository";
import type { StationRepository } from "@/data/StationRepository";
import { heatLevel } from "@/domain/availability";
import { trainWithinHours } from "@/domain/hours";
import type { DailyCounts, Train } from "@/domain/models";
import { addDays, frDate, frDateLong, iso, MONTHS, parseISO, today } from "@/lib/dates";
import { prettyStation } from "@/lib/text";
import { hourFields, hourFilter, hoursNote } from "../components/hours";
import { StationPair } from "../components/StationPair";
import { empty, errorState, loading } from "../components/states";
import { reserveButton, trainRow } from "../components/trains";
import { button, clear, el } from "../dom";
import type { View } from "./View";

const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const LEGEND: [string, string][] = [
  ["0", "lvl0"],
  ["1–2", "lvl1"],
  ["3–5", "lvl2"],
  ["6–9", "lvl3"],
  ["10+", "lvl4"],
];

/** 30-day availability heatmap for one origin/destination. */
export class CalendarView implements View {
  readonly id = "calendar";
  readonly label = "Calendrier";
  readonly emoji = "📅";
  readonly hint = "30 jours pour un trajet";
  readonly element: HTMLElement;

  private readonly pair: StationPair;
  private readonly summary = el("div", { class: "summary" });
  private readonly grid = el("div", { class: "cal" });
  private readonly detail = el("div", { class: "detail" });
  /** Les trains du jour ouvert, gardés pour pouvoir refiltrer sans requête. */
  private dayTrains: Train[] = [];
  private dayDate = "";
  private readonly dayList = el("div", { class: "train-list" });
  private readonly daySub = el("span", { class: "detail-sub" });

  constructor(
    private readonly repo: TgvmaxRepository,
    stations: StationRepository,
  ) {
    this.pair = new StationPair(stations, {
      fromPlaceholder: "ex. Paris",
      toPlaceholder: "ex. Lyon",
      fromValue: "PARIS (intramuros)",
      toValue: "LYON (intramuros)",
      onChange: () => void this.run(),
    });

    const controls = el("div", { class: "controls" }, [
      ...this.pair.nodes,
      ...hourFields(),
      button("Voir le calendrier", "btn-primary", () => void this.run()),
    ]);
    // La plage horaire est commune à tous les écrans : quand elle change
    // ailleurs, la journée ouverte ici doit suivre.
    hourFilter.subscribe(() => this.renderDayList());
    this.element = el("section", { class: "panel" }, [
      controls,
      this.summary,
      this.legend(),
      this.grid,
      this.detail,
    ]);
  }

  activate(): void {
    if (!this.grid.hasChildNodes()) void this.run();
  }

  /** Pre-fill from the command palette. */
  preset(origin: string, destination?: string): void {
    this.pair.set(origin, destination);
    void this.run();
  }

  private async run(): Promise<void> {
    const from = this.pair.fromValue;
    const to = this.pair.toValue;
    clear(this.detail);
    if (!from || !to) {
      empty(this.summary, "Choisissez une gare de départ et d'arrivée.");
      clear(this.grid);
      return;
    }
    if (from === to) {
      empty(this.summary, "Départ et arrivée identiques.");
      clear(this.grid);
      return;
    }
    loading(this.grid, "Calcul des disponibilités…");
    clear(this.summary);
    try {
      const counts = await this.repo.dailyCounts(from, to);
      this.renderCalendar(from, to, counts);
    } catch (e) {
      errorState(this.grid, `Impossible de récupérer les données (${(e as Error).message}).`);
    }
  }

  private renderCalendar(from: string, to: string, counts: DailyCounts): void {
    const start = today();
    const keys = Object.keys(counts);
    let end = addDays(start, 30);
    for (const k of keys) {
      const d = parseISO(k);
      if (d > end) end = d;
    }
    const days = keys.length;
    const trains = keys.reduce((sum, k) => sum + counts[k], 0);

    clear(this.summary).appendChild(
      el("div", {
        class: "sum-line",
        html:
          `<b>${prettyStation(from)}</b> → <b>${prettyStation(to)}</b> · ` +
          (days
            ? `<span class="ok">${days} jour${days > 1 ? "s" : ""}</span> avec place MAX · ${trains} trajet${trains > 1 ? "s" : ""} au total`
            : `<span class="ko">aucune place MAX</span> sur la fenêtre disponible`),
      }),
    );

    clear(this.grid);
    const head = el(
      "div",
      { class: "cal-head" },
      WEEKDAYS.map((d) => el("span", { text: d })),
    );
    this.grid.appendChild(head);

    const body = el("div", { class: "cal-grid" });
    let d = addDays(start, -((start.getDay() + 6) % 7)); // Monday of the current week
    for (let i = 0; i < 42; i += 1) {
      const ds = iso(d);
      const inWindow = d >= start && d <= end;
      const n = counts[ds] ?? 0;
      const level = inWindow ? heatLevel(n) : "x";
      const cell = el(
        "div",
        {
          class: `cell lvl${level}${inWindow ? "" : " out"}${n ? " has" : ""}`,
          title: inWindow ? frDateLong(ds) + (n ? ` · ${n} trajet(s) MAX` : " · aucune place") : "",
        },
        [
          d.getDate() === 1 ? el("span", { class: "cell-mon", text: MONTHS[d.getMonth()] }) : null,
          el("span", { class: "cell-num", text: String(d.getDate()) }),
          n ? el("span", { class: "cell-n", text: String(n) }) : null,
        ],
      );
      if (inWindow && n)
        cell.addEventListener("click", () => void this.showDay(from, to, ds, cell));
      body.appendChild(cell);
      d = addDays(d, 1);
    }
    this.grid.appendChild(body);
  }

  private async showDay(from: string, to: string, date: string, cell: HTMLElement): Promise<void> {
    // NB : ne pas réutiliser la classe "sel" (déjà prise par les <select> du thème).
    this.grid.querySelectorAll(".cell.selected").forEach((c) => c.classList.remove("selected"));
    cell.classList.add("selected");
    loading(this.detail, `Trajets du ${frDate(date)}…`);
    try {
      this.dayTrains = await this.repo.trains(from, to, date);
      this.dayDate = date;
      clear(this.detail);
      this.detail.appendChild(
        el("div", { class: "detail-head" }, [
          el("h3", { text: frDateLong(date) }),
          this.daySub,
          reserveButton("Réserver sur SNCF Connect ↗"),
        ]),
      );
      this.detail.appendChild(this.dayList);
      this.renderDayList();
      this.detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (e) {
      errorState(this.detail, (e as Error).message);
    }
  }

  /**
   * (Re)dessine la liste du jour ouvert selon la plage horaire.
   *
   * Le filtre ne relance aucune requête : les trains sont déjà là. Ce qui est
   * écarté est compté et dit, sinon une liste vide passerait pour une absence
   * de place alors que c'est un réglage qui la vide.
   */
  private renderDayList(): void {
    if (!this.dayDate) return;
    const kept = this.dayTrains.filter((t) => trainWithinHours(t, hourFilter.value));
    this.daySub.textContent =
      `${kept.length} trajet(s) avec place MAX` + hoursNote(this.dayTrains.length - kept.length);
    clear(this.dayList).append(...kept.map((t) => trainRow(t)));
  }

  private legend(): HTMLElement {
    const lg = el("div", { class: "legend" }, [
      el("span", { class: "lg-lab", text: "Places MAX :" }),
    ]);
    for (const [text, cls] of LEGEND) {
      lg.appendChild(
        el("span", { class: "lg-item" }, [
          el("span", { class: `lg-sw ${cls}` }),
          el("span", { text }),
        ]),
      );
    }
    return lg;
  }
}
