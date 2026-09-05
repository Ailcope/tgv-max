import { FreePlacesRepository } from "@/data/FreePlacesRepository";
import type { TgvmaxRepository } from "@/data/TgvmaxRepository";
import type { StationRepository } from "@/data/StationRepository";
import { heatLevel } from "@/domain/availability";
import type { DailyCounts, DaySeats, SeatsByDate, Train } from "@/domain/models";
import { isAlarming, tensionMessage, tensionOf } from "@/domain/tension";
import { addDays, frDate, frDateLong, iso, MONTHS, parseISO, today } from "@/lib/dates";
import { prettyStation } from "@/lib/text";
import { StationPicker } from "../components/StationPicker";
import { empty, errorState, loading } from "../components/states";
import { alertBox } from "../components/tension";
import { reserveButton, trainRow } from "../components/trains";
import { button, clear, el, field, select } from "../dom";
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

  private readonly fromPicker: StationPicker;
  private readonly toPicker: StationPicker;
  private readonly summary = el("div", { class: "summary" });
  private readonly grid = el("div", { class: "cal" });
  private readonly detail = el("div", { class: "detail" });
  /** Places restantes du dernier affichage, vide quand le relais est absent. */
  private seats: SeatsByDate = {};
  private readonly minSeatsSelect: HTMLSelectElement;
  private readonly minSeatsField: HTMLElement;
  /** Les trains du jour ouvert, gardés pour refiltrer sans nouvelle requête. */
  private dayTrains: Train[] = [];
  private dayDate = "";
  private readonly dayList = el("div", { class: "train-list" });
  private readonly daySub = el("span", { class: "detail-sub" });

  constructor(
    private readonly repo: TgvmaxRepository,
    stations: StationRepository,
    private readonly freePlaces?: FreePlacesRepository,
  ) {
    this.fromPicker = new StationPicker(stations, {
      placeholder: "ex. Paris",
      value: "PARIS (intramuros)",
      onSelect: () => void this.run(),
    });
    this.toPicker = new StationPicker(stations, {
      placeholder: "ex. Lyon",
      value: "LYON (intramuros)",
      onSelect: () => void this.run(),
    });
    const swap = button("⇄", "swap", () => this.swap());
    swap.title = "Inverser";
    this.minSeatsSelect = select(
      [
        ["1", "au moins 1 place"],
        ["2", "au moins 2 places"],
        ["4", "au moins 4 places"],
      ],
      () => this.renderDayList(),
    );
    // Le champ n'a de sens que si le nombre de places est connu : sans relais,
    // il proposerait un filtre qui ne filtre rien.
    this.minSeatsField = field("Voyageurs", this.minSeatsSelect);
    if (!this.freePlaces?.enabled) this.minSeatsField.style.display = "none";

    const controls = el("div", { class: "controls" }, [
      field("Départ", this.fromPicker.element),
      swap,
      field("Arrivée", this.toPicker.element),
      this.minSeatsField,
      button("Voir le calendrier", "btn-primary", () => void this.run()),
    ]);
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
    this.fromPicker.set(origin);
    if (destination) this.toPicker.set(destination);
    void this.run();
  }

  private swap(): void {
    const a = this.fromPicker.value;
    const b = this.toPicker.value;
    this.fromPicker.clear();
    this.toPicker.clear();
    if (b) this.fromPicker.set(b);
    if (a) this.toPicker.set(a);
    void this.run();
  }

  private async run(): Promise<void> {
    const from = this.fromPicker.value;
    const to = this.toPicker.value;
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
    this.seats = {};
    try {
      const counts = await this.repo.dailyCounts(from, to);
      // La grille s'affiche tout de suite avec le nombre de trains ; les places
      // arrivent après, en second passage. Le calendrier n'attend pas après un
      // service tiers qui peut être lent, ou absent.
      this.renderCalendar(from, to, counts);
      const seats = await this.loadSeats(from, to, counts);
      if (seats && this.stillShowing(from, to)) {
        this.seats = seats;
        this.renderCalendar(from, to, counts);
      }
    } catch (e) {
      errorState(this.grid, `Impossible de récupérer les données (${(e as Error).message}).`);
    }
  }

  /** Vrai si l'utilisateur n'a pas changé d'O/D pendant le chargement des places. */
  private stillShowing(from: string, to: string): boolean {
    return this.fromPicker.value === from && this.toPicker.value === to;
  }

  /**
   * Places restantes sur les journées qui ont au moins un train. Interroger les
   * journées vides ne rapporterait rien et triplerait le nombre d'appels.
   */
  private async loadSeats(
    from: string,
    to: string,
    counts: DailyCounts,
  ): Promise<SeatsByDate | null> {
    if (!this.freePlaces?.enabled) return null;
    const dates = Object.keys(counts).filter((d) => counts[d] > 0);
    if (!dates.length) return null;
    const pair = await this.repo.codePair(from, to).catch(() => null);
    if (!pair) return null;
    return this.freePlaces.range(pair[0], pair[1], dates);
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
      // Le nombre de places, quand on l'a. La tension est donnée par le train le
      // plus juste de la journée : un total confortable réparti sur dix trains
      // ne console pas si celui qui vous arrange n'a plus que deux places.
      const day = inWindow && n ? this.seats[ds] : undefined;
      const tension = day ? tensionOf(day.minSeats) : "unknown";
      const cell = el(
        "div",
        {
          class:
            `cell lvl${level}${inWindow ? "" : " out"}${n ? " has" : ""}` +
            (isAlarming(tension) ? ` cell-${tension}` : ""),
          title: inWindow ? cellTitle(ds, n, day) : "",
        },
        [
          d.getDate() === 1 ? el("span", { class: "cell-mon", text: MONTHS[d.getMonth()] }) : null,
          el("span", { class: "cell-num", text: String(d.getDate()) }),
          n ? el("span", { class: "cell-n", text: String(n) }) : null,
          day ? el("span", { class: "cell-seats", text: `${day.seats} pl.` }) : null,
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
      const raw = await this.repo.trains(from, to, date);
      const day = this.seats[date] ?? null;
      this.dayTrains = FreePlacesRepository.attach(raw, day);
      this.dayDate = date;
      clear(this.detail);
      this.detail.appendChild(
        el("div", { class: "detail-head" }, [
          el("h3", { text: frDateLong(date) }),
          this.daySub,
          reserveButton("Réserver sur SNCF Connect ↗"),
        ]),
      );
      const tension = day ? tensionOf(day.minSeats) : "unknown";
      if (day && isAlarming(tension)) {
        this.detail.appendChild(
          alertBox(
            tension,
            `${tensionMessage(tension, day.minSeats)} ` +
              `Le train le plus juste de la journée n'a plus que ${day.minSeats} place(s).`,
          ),
        );
      }
      this.detail.appendChild(this.dayList);
      this.renderDayList();
      this.detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (e) {
      errorState(this.detail, (e as Error).message);
    }
  }

  /**
   * (Re)dessine la liste du jour ouvert selon le nombre de places demandé.
   *
   * Un train dont le nombre de places est inconnu reste affiché : le MAX
   * Planner et le jeu de données ouvert ne recensent pas exactement les mêmes
   * circulations, et « inconnu » ne veut pas dire « complet ». Le filtre écarte
   * ce qu'on sait insuffisant, jamais ce qu'on ignore.
   */
  private renderDayList(): void {
    if (!this.dayDate) return;
    const min = Number(this.minSeatsSelect.value);
    const kept = this.dayTrains.filter((t) => t.seats === undefined || t.seats >= min);
    const short = this.dayTrains.length - kept.length;
    this.daySub.textContent =
      `${kept.length} trajet(s) avec place MAX` +
      (short ? ` · ${short} sous ${min} place${min > 1 ? "s" : ""}` : "");
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

/** Infobulle d'une case : date, trains, et places restantes quand on les a. */
function cellTitle(date: string, trains: number, day?: DaySeats): string {
  const head = frDateLong(date);
  if (!trains) return `${head} · aucune place`;
  const base = `${head} · ${trains} trajet(s) MAX`;
  if (!day) return base;
  return (
    `${base} · ${day.seats} place(s) restantes` +
    (day.trains > 1 ? `, dont ${day.minSeats} sur le train le plus juste` : "")
  );
}
