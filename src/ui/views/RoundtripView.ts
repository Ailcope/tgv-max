import * as L from "leaflet";
import type { StationRepository } from "@/data/StationRepository";
import type { TgvmaxRepository } from "@/data/TgvmaxRepository";
import type { Train } from "@/domain/models";
import { planJourneys, transferWaits, type Journey } from "@/domain/connections";
import {
  asJourney,
  datesBetween,
  groupByDate,
  planDatedTrips,
  planDayTrips,
  planWeekends,
  type TrainsByDate,
} from "@/domain/roundtrip";
import { durationMinutes, formatDuration, hhmmToMinutes } from "@/domain/time";
import { addDays, DOWS, frDate, frDateLong, iso, parseISO, today } from "@/lib/dates";
import { Latest } from "@/lib/latest";
import { prettyStation } from "@/lib/text";
import { rememberedSelect } from "../components/options";
import { StationPicker } from "../components/StationPicker";
import { empty, errorState, loading, skeleton } from "../components/states";
import { axisBadge, legReserveLink } from "../components/trains";
import { button, clear, el, field } from "../dom";
import { createMap, destIcon, type MapHandle, originIcon } from "../map/MapKit";
import type { View } from "./View";

/** Same-day round trips and weekend getaways with MAX seats both ways. */
export class RoundtripView implements View {
  readonly id = "roundtrip";
  readonly label = "Aller-retour";
  readonly emoji = "🔁";
  readonly hint = "journée & week-end";
  readonly element: HTMLElement;
  onStateChange?: () => void;

  private readonly fromPicker: StationPicker;
  private readonly toPicker: StationPicker;
  private readonly modeSelect: HTMLSelectElement;
  private readonly staySelect: HTMLSelectElement;
  private readonly earlySelect: HTMLSelectElement;
  private readonly lateSelect: HTMLSelectElement;
  private readonly departFrom: HTMLInputElement;
  private readonly departTo: HTMLInputElement;
  private readonly returnFrom: HTMLInputElement;
  private readonly returnTo: HTMLInputElement;
  private readonly nightsSelect: HTMLSelectElement;
  private readonly viaSelect: HTMLSelectElement;
  private readonly summary = el("div", { class: "summary" });
  private readonly mapEl = el("div", { class: "map map-sm" });
  private readonly out = el("div", { class: "rt-list" });
  private readonly handle: MapHandle;
  private loaded = false;
  /** Deux recherches peuvent se croiser : seule la dernière écrit à l'écran. */
  private readonly latest = new Latest();

  constructor(
    private readonly repo: TgvmaxRepository,
    private readonly stations: StationRepository,
  ) {
    this.fromPicker = new StationPicker(stations, {
      placeholder: "ex. Paris",
      value: "PARIS (intramuros)",
      onSelect: () => void this.run(),
    });
    this.toPicker = new StationPicker(stations, {
      placeholder: "ex. Bordeaux",
      value: "BORDEAUX ST JEAN",
      onSelect: () => void this.run(),
    });
    const swap = button("⇄", "swap", () => this.swap());
    swap.title = "Inverser";

    this.modeSelect = rememberedSelect(
      "allerRetour.formule",
      [
        ["day", "Aller-retour dans la journée"],
        ["weekend", "Escapade de week-end"],
        ["dates", "Mes dates"],
      ],
      "day",
      () => {
        this.toggleFields();
        void this.run();
      },
    );
    // Bornes du mode « Mes dates ». Deux intervalles plutôt que deux dates
    // fermes : on part rarement un jour précis, on part « dans ces eaux-là ».
    this.departFrom = dateInput(iso(today()), () => void this.run());
    this.departTo = dateInput(iso(addDays(today(), 7)), () => void this.run());
    this.returnFrom = dateInput(iso(addDays(today(), 2)), () => void this.run());
    this.returnTo = dateInput(iso(addDays(today(), 10)), () => void this.run());
    this.nightsSelect = rememberedSelect(
      "allerRetour.nuits",
      [
        ["0", "Peu importe"],
        ["1", "≥ 1 nuit"],
        ["2", "≥ 2 nuits"],
        ["3", "≥ 3 nuits"],
      ],
      "0",
      () => void this.run(),
    );
    // Les correspondances demandent le dump complet des trains de chaque
    // journée : c'est lourd, on ne l'active donc que sur des dates choisies.
    this.viaSelect = rememberedSelect(
      "allerRetour.via",
      [
        ["1", "Trajets directs"],
        ["2", "Jusqu'à 1 correspondance"],
        ["3", "Jusqu'à 2 correspondances"],
      ],
      "1",
      () => void this.run(),
    );
    this.staySelect = rememberedSelect(
      "allerRetour.surPlace",
      [
        ["180", "≥ 3h sur place"],
        ["240", "≥ 4h sur place"],
        ["300", "≥ 5h sur place"],
        ["360", "≥ 6h sur place"],
        ["480", "≥ 8h sur place"],
      ],
      "240",
      () => void this.run(),
    );
    this.earlySelect = rememberedSelect(
      "allerRetour.pasAvant",
      [
        ["0", "Peu importe"],
        ["360", "dès 6h"],
        ["420", "dès 7h"],
        ["480", "dès 8h"],
        ["540", "dès 9h"],
        ["600", "dès 10h"],
      ],
      "0",
      () => void this.run(),
    );
    this.lateSelect = rememberedSelect(
      "allerRetour.pasApres",
      [
        ["0", "Peu importe"],
        ["1080", "avant 18h"],
        ["1200", "avant 20h"],
        ["1260", "avant 21h"],
        ["1320", "avant 22h"],
      ],
      "0",
      () => void this.run(),
    );

    const controls = el("div", { class: "controls" }, [
      field("Départ", this.fromPicker.element),
      swap,
      field("Arrivée", this.toPicker.element),
      field("Formule", this.modeSelect),
      field("Sur place", this.staySelect),
      field("Aller entre le", this.departFrom),
      field("et le", this.departTo),
      field("Retour entre le", this.returnFrom),
      field("et le", this.returnTo),
      field("Sur place", this.nightsSelect),
      field("Correspondances", this.viaSelect),
      field("Aller pas avant", this.earlySelect),
      field("Retour pas après", this.lateSelect),
      button("Planifier", "btn-primary", () => void this.run()),
    ]);
    this.element = el("section", { class: "panel" }, [
      controls,
      this.summary,
      el("div", { class: "map-wrap" }, [this.mapEl]),
      this.out,
    ]);
    this.handle = createMap(this.mapEl, { zoom: 6 });
    // Les champs qui dépendent de la formule sont mis en cohérence dès la
    // construction : celle-ci étant désormais retenue, « Sur place » doit
    // déjà être masqué quand on repart sur une escapade de week-end.
    this.toggleFields();
  }

  activate(): void {
    if (!this.loaded) void this.run();
    setTimeout(() => this.handle.map.invalidateSize(), 60);
  }

  /** Chaque formule n'a pas besoin des mêmes réglages : on masque le reste. */
  private toggleFields(): void {
    const mode = this.modeSelect.value;
    const show = (control: HTMLElement, visible: boolean): void => {
      const wrapper = control.parentElement;
      if (wrapper) wrapper.style.display = visible ? "" : "none";
    };
    show(this.staySelect, mode === "day");
    const dated = mode === "dates";
    for (const c of [this.departFrom, this.departTo, this.returnFrom, this.returnTo]) {
      show(c, dated);
    }
    show(this.nightsSelect, dated);
    show(this.viaSelect, dated);
  }

  /** Le trajet et la formule ; les seuils horaires restent des réglages. */
  state(): Record<string, string> {
    return {
      from: this.fromPicker.value ?? "",
      to: this.toPicker.value ?? "",
      formule: this.modeSelect.value,
    };
  }

  restore(params: Record<string, string>): void {
    if (params.from) this.fromPicker.set(params.from);
    if (params.to) this.toPicker.set(params.to);
    if (["day", "weekend", "dates"].includes(params.formule)) {
      this.modeSelect.value = params.formule;
      this.toggleFields();
    }
    this.loaded = false; // `activate` relancera la recherche
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
    if (!from || !to || from === to) {
      this.latest.cancel();
      empty(this.summary, "Choisissez deux gares différentes.");
      clear(this.out);
      return;
    }
    this.drawMap(from, to);
    const isCurrent = this.latest.begin();
    skeleton(this.out, "rows", 4);
    clear(this.summary);
    this.onStateChange?.();
    if (this.modeSelect.value === "dates") return this.runDated(from, to);
    try {
      const [outbound, inbound] = await Promise.all([
        this.repo.directTrains(from, to),
        this.repo.directTrains(to, from),
      ]);
      const early = Number(this.earlySelect.value);
      const late = Number(this.lateSelect.value);
      const outByDate = filterMap(
        groupByDate(outbound),
        (t) => hhmmToMinutes(t.departure) >= early,
      );
      const inByDate = filterMap(
        groupByDate(inbound),
        (t) => !late || hhmmToMinutes(t.departure) <= late,
      );
      if (!isCurrent()) return; // une recherche plus récente est passée devant
      this.loaded = true;
      if (this.modeSelect.value === "day") this.renderDay(from, to, outByDate, inByDate);
      else this.renderWeekend(from, to, outByDate, inByDate);
    } catch (e) {
      if (!isCurrent()) return;
      errorState(this.out, (e as Error).message);
    }
  }

  /**
   * Mode « Mes dates » : l'utilisateur donne une fenêtre d'aller et une fenêtre
   * de retour, et on cherche les combinaisons, avec correspondances s'il le
   * demande.
   */
  private async runDated(from: string, to: string): Promise<void> {
    const departDates = datesBetween(this.departFrom.value, this.departTo.value, MAX_DATES);
    const returnDates = datesBetween(this.returnFrom.value, this.returnTo.value, MAX_DATES);
    if (!departDates.length || !returnDates.length) {
      empty(this.summary, "Vérifiez les intervalles de dates : la fin doit suivre le début.");
      clear(this.out);
      return;
    }
    const maxLegs = Number(this.viaSelect.value);
    try {
      const [outbound, inbound] =
        maxLegs > 1
          ? await this.datedWithConnections(from, to, departDates, returnDates, maxLegs)
          : await this.datedDirect(from, to, departDates, returnDates);
      this.loaded = true;
      this.renderDated(from, to, outbound, inbound, maxLegs);
    } catch (e) {
      errorState(this.out, (e as Error).message);
    }
  }

  /** Trajets directs : une requête par sens sur toute la fenêtre, puis découpage. */
  private async datedDirect(
    from: string,
    to: string,
    departDates: string[],
    returnDates: string[],
  ): Promise<[JourneysByDate, JourneysByDate]> {
    const [out, back] = await Promise.all([
      this.repo.directTrains(from, to),
      this.repo.directTrains(to, from),
    ]);
    const early = Number(this.earlySelect.value);
    const late = Number(this.lateSelect.value);
    return [
      pickDates(groupByDate(out), departDates, (t) => hhmmToMinutes(t.departure) >= early),
      pickDates(groupByDate(back), returnDates, (t) => !late || hhmmToMinutes(t.departure) <= late),
    ];
  }

  /**
   * Avec correspondances : il faut tous les trains de chaque journée, pas
   * seulement ceux de l'O/D. C'est un chargement par date, d'où la fenêtre
   * volontairement courte et le message d'attente explicite.
   */
  private async datedWithConnections(
    from: string,
    to: string,
    departDates: string[],
    returnDates: string[],
    maxLegs: number,
  ): Promise<[JourneysByDate, JourneysByDate]> {
    const all = [...new Set([...departDates, ...returnDates])].sort().slice(0, MAX_DATES_VIA);
    loading(
      this.out,
      `Chargement des trains de ${all.length} journée${all.length > 1 ? "s" : ""}, ` +
        "puis recherche des itinéraires…",
    );
    const days = await Promise.all(
      all.map(async (d) => [d, await this.repo.allTrainsOn(d)] as const),
    );
    const early = Number(this.earlySelect.value);
    const late = Number(this.lateSelect.value);
    const outbound: JourneysByDate = {};
    const inbound: JourneysByDate = {};
    for (const [date, trains] of days) {
      if (departDates.includes(date)) {
        const found = planJourneys(trains, from, to, { maxLegs }).filter(
          (j) => hhmmToMinutes(j.departure) >= early,
        );
        if (found.length) outbound[date] = found;
      }
      if (returnDates.includes(date)) {
        const found = planJourneys(trains, to, from, { maxLegs }).filter(
          (j) => !late || hhmmToMinutes(j.departure) <= late,
        );
        if (found.length) inbound[date] = found;
      }
    }
    return [outbound, inbound];
  }

  private renderDated(
    from: string,
    to: string,
    outbound: JourneysByDate,
    inbound: JourneysByDate,
    maxLegs: number,
  ): void {
    const trips = planDatedTrips(outbound, inbound, {
      minNights: Number(this.nightsSelect.value),
    });
    clear(this.summary).appendChild(
      el("div", {
        class: "sum-line",
        html:
          `Aller-retour <b>${prettyStation(from)}</b> ⇄ <b>${prettyStation(to)}</b> sur vos dates · ` +
          (trips.length
            ? `<span class="ok">${trips.length} combinaison${trips.length > 1 ? "s" : ""}</span>`
            : `<span class="ko">aucune combinaison</span> avec place MAX dans les deux sens`) +
          (maxLegs > 1 ? " · correspondances autorisées" : " · trajets directs"),
      }),
    );
    clear(this.out);
    if (!trips.length) {
      empty(
        this.out,
        maxLegs > 1
          ? "Rien sur ces dates, même en changeant de train. Élargissez les fenêtres."
          : "Rien en direct sur ces dates. Essayez d'autoriser les correspondances.",
      );
      return;
    }
    for (const t of trips) {
      this.out.appendChild(
        el("div", { class: "rt-card" }, [
          el("div", { class: "rt-date" }, [
            el("b", { text: `${frDate(t.departDate)} → ${frDate(t.returnDate)}` }),
            el("span", {
              class: "rt-stay",
              text: t.nights
                ? `${t.nights} nuit${t.nights > 1 ? "s" : ""} sur place`
                : "dans la journée",
            }),
          ]),
          el("div", { class: "rt-legs" }, [
            journeyBlock("Aller", from, to, t.outbound, t.departDate),
            journeyBlock("Retour", to, from, t.back, t.returnDate),
          ]),
        ]),
      );
    }
  }

  private renderDay(
    from: string,
    to: string,
    outByDate: TrainsByDate,
    inByDate: TrainsByDate,
  ): void {
    const trips = planDayTrips(outByDate, inByDate, Number(this.staySelect.value));
    clear(this.summary).appendChild(
      el("div", {
        class: "sum-line",
        html:
          `Aller-retour <b>${prettyStation(from)}</b> ⇄ <b>${prettyStation(to)}</b> dans la journée · ` +
          (trips.length
            ? `<span class="ok">${trips.length} jour${trips.length > 1 ? "s" : ""}</span> possible${trips.length > 1 ? "s" : ""}`
            : `<span class="ko">aucune journée possible</span> avec ce temps sur place`),
      }),
    );
    clear(this.out);
    if (!trips.length) {
      empty(
        this.out,
        "Aucun aller-retour MAX dans la journée. Réduisez le temps sur place ou changez de destination.",
      );
      return;
    }
    for (const t of trips) {
      this.out.appendChild(
        el("div", { class: "rt-card" }, [
          el("div", { class: "rt-date" }, [
            el("b", { text: frDateLong(t.date) }),
            el("span", { class: "rt-stay", text: `${formatDuration(t.stayMinutes)} sur place` }),
          ]),
          el("div", { class: "rt-legs" }, [
            leg("Aller", from, to, t.outbound, t.date),
            leg("Retour", to, from, t.back, t.date),
          ]),
        ]),
      );
    }
  }

  private renderWeekend(
    from: string,
    to: string,
    outByDate: TrainsByDate,
    inByDate: TrainsByDate,
  ): void {
    const combos = planWeekends(outByDate, inByDate, today());
    clear(this.summary).appendChild(
      el("div", {
        class: "sum-line",
        html:
          `Escapades de week-end <b>${prettyStation(from)}</b> ⇄ <b>${prettyStation(to)}</b> · ` +
          (combos.length
            ? `<span class="ok">${combos.length} week-end${combos.length > 1 ? "s" : ""}</span> jouable${combos.length > 1 ? "s" : ""}`
            : `<span class="ko">aucun week-end</span> avec place MAX dans les deux sens`),
      }),
    );
    clear(this.out);
    if (!combos.length) {
      empty(
        this.out,
        "Aucun week-end MAX aller-retour sur la fenêtre. Essayez une autre destination.",
      );
      return;
    }
    for (const c of combos) {
      this.out.appendChild(
        el("div", { class: "rt-card" }, [
          el("div", { class: "rt-date" }, [el("b", { text: `Week-end du ${frDate(c.saturday)}` })]),
          weekendGroup("Aller", from, to, collect(c.departDates, outByDate)),
          weekendGroup("Retour", to, from, collect(c.returnDates, inByDate)),
        ]),
      );
    }
  }

  private drawMap(from: string, to: string): void {
    const a = this.stations.get(from);
    const b = this.stations.get(to);
    this.handle.routes.clearLayers();
    this.handle.markers.clearLayers();
    if (!a || !b) return;
    const pa: L.LatLngTuple = [a.lat, a.lon];
    const pb: L.LatLngTuple = [b.lat, b.lon];
    L.marker(pa, { icon: originIcon() })
      .addTo(this.handle.markers)
      .bindTooltip(`${prettyStation(from)} · départ`, { direction: "top" });
    L.marker(pb, { icon: destIcon() })
      .addTo(this.handle.markers)
      .bindTooltip(`${prettyStation(to)} · arrivée`, { direction: "top" });
    this.handle.map.fitBounds([pa, pb], { padding: [50, 50], maxZoom: 9 });
    setTimeout(() => this.handle.map.invalidateSize(), 30);
  }
}

/** Keep only trains matching `pred` per date; drop emptied dates. */
function filterMap(map: TrainsByDate, pred: (t: Train) => boolean): TrainsByDate {
  const out: TrainsByDate = {};
  for (const [date, list] of Object.entries(map)) {
    const kept = list.filter(pred);
    if (kept.length) out[date] = kept;
  }
  return out;
}

/** Flatten several dates' trains into `[date, train]` pairs, sorted. */
function collect(dates: string[], byDate: TrainsByDate): [string, Train][] {
  const rows: [string, Train][] = [];
  for (const d of dates) for (const t of byDate[d] ?? []) rows.push([d, t]);
  return rows.sort(
    (a, b) => a[0].localeCompare(b[0]) || a[1].departure.localeCompare(b[1].departure),
  );
}

function leg(label: string, a: string, b: string, t: Train, date: string): HTMLElement {
  return el("div", { class: "rt-leg" }, [
    el("span", { class: `rt-tag${label === "Retour" ? " tag-ret" : ""}`, text: label }),
    el("span", { class: "rt-od", text: `${prettyStation(a)} → ${prettyStation(b)}` }),
    el("span", { class: "rt-time", html: `<b>${t.departure}</b> → <b>${t.arrival}</b>` }),
    el("span", { class: "t-dur", text: formatDuration(durationMinutes(t.departure, t.arrival)) }),
    axisBadge(t.axis),
    el("span", { class: "t-no", text: `n°${t.trainNo}` }),
    legReserveLink(t, date),
  ]);
}

function weekendGroup(label: string, a: string, b: string, rows: [string, Train][]): HTMLElement {
  const group = el("div", { class: "wk-group" }, [
    el("div", { class: "wk-lab" }, [
      el("span", { class: `rt-tag${label === "Retour" ? " tag-ret" : ""}`, text: label }),
      el("span", { class: "rt-od", text: `${prettyStation(a)} → ${prettyStation(b)}` }),
    ]),
  ]);
  for (const [date, t] of rows) {
    const d = parseISO(date);
    group.appendChild(
      el("div", { class: "train" }, [
        el("span", { class: "wk-day", text: `${DOWS[d.getDay()]} ${d.getDate()}` }),
        el("span", {
          class: "t-time",
          html: `<b>${t.departure}</b><span class="arrow"> → </span><b>${t.arrival}</b>`,
        }),
        el("span", {
          class: "t-dur",
          text: formatDuration(durationMinutes(t.departure, t.arrival)),
        }),
        axisBadge(t.axis),
        el("span", { class: "t-no", text: `n°${t.trainNo}` }),
        legReserveLink(t, date),
      ]),
    );
  }
  return group;
}

/** Fenêtre maximale d'un intervalle de dates, et sa version « avec correspondances ». */
const MAX_DATES = 31;
/** Un chargement complet par journée : au-delà, l'attente n'est plus tenable. */
const MAX_DATES_VIA = 8;

/** Trajets groupés par date, comme {@link TrainsByDate} mais après recherche. */
type JourneysByDate = Record<string, Journey[]>;

/**
 * Restreint des trains groupés par date aux seules dates voulues, en appliquant
 * un filtre horaire, et les convertit en trajets à une jambe.
 */
function pickDates(
  byDate: TrainsByDate,
  dates: string[],
  keep: (t: Train) => boolean,
): JourneysByDate {
  const out: JourneysByDate = {};
  for (const date of dates) {
    const kept = (byDate[date] ?? []).filter(keep);
    if (kept.length) out[date] = kept.map(asJourney);
  }
  return out;
}

/** Un `<input type="date">` borné à aujourd'hui, relié à un gestionnaire. */
function dateInput(value: string, onChange: () => void): HTMLInputElement {
  const input = el("input", { class: "date-input", type: "date", min: iso(today()), value });
  input.addEventListener("change", onChange);
  return input;
}

/** Un sens du voyage : le trajet complet, correspondances détaillées. */
function journeyBlock(label: string, a: string, b: string, j: Journey, date: string): HTMLElement {
  const summary = el("div", { class: "rt-leg" }, [
    el("span", { class: `rt-tag${label === "Retour" ? " tag-ret" : ""}`, text: label }),
    el("span", { class: "rt-od", text: `${prettyStation(a)} → ${prettyStation(b)}` }),
    el("span", {
      class: "rt-time",
      html: `<b>${j.departure}</b> → <b>${j.arrival}</b>${j.arrivesNextDay ? ' <span class="t-j1">J+1</span>' : ""}`,
    }),
    el("span", { class: "t-dur", text: formatDuration(j.totalMinutes) }),
    el("span", {
      class: "jy-transfers" + (j.transfers ? "" : " jy-direct"),
      text: j.transfers ? `${j.transfers} corresp.` : "direct",
    }),
  ]);
  const block = el("div", { class: "rt-leg-group" }, [summary]);
  // Un direct se réserve depuis sa ligne de résumé ; sur une correspondance,
  // c'est chaque train qui porte son lien, un billet MAX par jambe.
  if (!j.transfers) {
    summary.appendChild(legReserveLink(j.legs[0], date));
    return block;
  }
  const waits = transferWaits(j);
  j.legs.forEach((t, i) => {
    if (i > 0) {
      block.appendChild(
        el("div", {
          class: "jy-wait",
          text: `⏱ ${formatDuration(waits[i - 1])} de correspondance à ${prettyStation(t.origin)}`,
        }),
      );
    }
    block.appendChild(
      el("div", { class: "train" }, [
        el("span", {
          class: "t-od",
          text: `${prettyStation(t.origin)} → ${prettyStation(t.destination)}`,
        }),
        el("span", {
          class: "t-time",
          html: `<b>${t.departure}</b><span class="arrow"> → </span><b>${t.arrival}</b>`,
        }),
        el("span", {
          class: "t-dur",
          text: formatDuration(durationMinutes(t.departure, t.arrival)),
        }),
        axisBadge(t.axis),
        el("span", { class: "t-no", text: `n°${t.trainNo}` }),
        legReserveLink(t, date),
      ]),
    );
  });
  return block;
}
