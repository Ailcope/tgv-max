import type { StationRepository } from "@/data/StationRepository";
import type { TgvmaxRepository } from "@/data/TgvmaxRepository";
import { bookingUrl } from "@/domain/booking";
import { planJourneys, transferWaits, type Journey } from "@/domain/connections";
import { withinHours } from "@/domain/hours";
import { durationMinutes, formatDuration } from "@/domain/time";
import { addDays, frDateLong, iso, parseISO, today } from "@/lib/dates";
import { Latest } from "@/lib/latest";
import { prettyStation } from "@/lib/text";
import { hourFields, hourFilter, hoursNote } from "../components/hours";
import { rememberedSelect } from "../components/options";
import { StationPair } from "../components/StationPair";
import { DATASET_WINDOW, empty, errorState, hint, skeleton } from "../components/states";
import { axisBadge, legReserveLink, nextDayChip, reserveButton } from "../components/trains";
import { button, clear, el, field } from "../dom";
import type { View } from "./View";

/**
 * « Correspondances » : journeys with connections when the direct trains are
 * full: the whole day of MAX trains is fetched once, then searched locally
 * (see {@link planJourneys}).
 */
export class ConnectionsView implements View {
  readonly id = "connections";
  readonly label = "Correspondances";
  readonly emoji = "🔀";
  readonly hint = "quand le direct est complet";
  readonly element: HTMLElement;
  onStateChange?: () => void;

  private readonly pair: StationPair;
  private readonly dateInput: HTMLInputElement;
  private readonly transferSelect: HTMLSelectElement;
  private readonly legsSelect: HTMLSelectElement;
  private readonly summary = el("div", { class: "summary" });
  private readonly out = el("div", { class: "rt-list" });
  private loaded = false;
  /** Deux recherches peuvent se croiser : seule la dernière écrit à l'écran. */
  private readonly latest = new Latest();
  /** Les itinéraires calculés, gardés pour refiltrer sans tout recalculer. */
  private journeys: Journey[] = [];

  constructor(
    private readonly repo: TgvmaxRepository,
    stations: StationRepository,
  ) {
    this.pair = new StationPair(stations, {
      fromPlaceholder: "ex. Paris",
      toPlaceholder: "ex. Marseille",
      fromValue: "PARIS (intramuros)",
      toValue: "MARSEILLE ST CHARLES",
      onChange: () => void this.run(),
    });
    this.dateInput = el("input", {
      class: "date-input",
      type: "date",
      min: iso(today()),
      value: iso(today()),
    });
    this.dateInput.addEventListener("change", () => void this.run());
    this.transferSelect = rememberedSelect(
      "corresp.attente",
      [
        ["15", "corresp. ≥ 15 min"],
        ["20", "corresp. ≥ 20 min"],
        ["30", "corresp. ≥ 30 min"],
        ["45", "corresp. ≥ 45 min"],
      ],
      "20",
      () => void this.run(),
    );
    this.legsSelect = rememberedSelect(
      "corresp.jambes",
      [
        ["2", "1 correspondance"],
        ["3", "2 correspondances"],
        ["4", "3 correspondances"],
      ],
      "3",
      () => void this.run(),
    );

    const controls = el("div", { class: "controls" }, [
      ...this.pair.nodes,
      field("Date", this.dateInput),
      ...hourFields(),
      field("Correspondance", this.transferSelect),
      field("Jusqu'à", this.legsSelect),
      button("Chercher", "btn-primary", () => void this.run()),
    ]);
    this.element = el("section", { class: "panel" }, [
      controls,
      hint(
        "Astuce : quand un trajet direct n'a plus de place MAX, il en reste souvent en coupant en deux (souvent via Paris ou Lyon).",
      ),
      this.summary,
      this.out,
    ]);
    // Plage horaire commune : une modification faite ailleurs doit se voir ici
    // sans relancer la recherche, puisque les itinéraires sont déjà calculés.
    hourFilter.subscribe(() => this.rerender());
  }

  activate(): void {
    if (!this.loaded) void this.run();
  }

  /** Pre-fill from the command palette. */
  preset(origin: string, destination?: string): void {
    this.pair.set(origin, destination);
    void this.run();
  }

  /** Le trajet et le jour ; les seuils de correspondance restent des réglages. */
  state(): Record<string, string> {
    return {
      from: this.pair.fromValue ?? "",
      to: this.pair.toValue ?? "",
      date: this.dateInput.value,
    };
  }

  restore(params: Record<string, string>): void {
    this.pair.set(params.from, params.to);
    if (params.date) this.dateInput.value = params.date;
    this.loaded = false; // `activate` relancera la recherche
  }

  private async run(): Promise<void> {
    const from = this.pair.fromValue;
    const to = this.pair.toValue;
    const date = this.dateInput.value;
    if (!from || !to || from === to || !date) {
      this.latest.cancel();
      empty(this.summary, "Choisissez deux gares différentes et une date.");
      clear(this.out);
      return;
    }
    const isCurrent = this.latest.begin();
    skeleton(this.out, "rows", 5);
    clear(this.summary);
    this.onStateChange?.();
    try {
      const trains = await this.repo.allTrainsOn(date);
      if (!isCurrent()) return; // une recherche plus récente est passée devant
      this.journeys = planJourneys(trains, from, to, {
        maxLegs: Number(this.legsSelect.value),
        minTransferMinutes: Number(this.transferSelect.value),
      });
      this.loaded = true;
      this.render(from, to, date, this.journeys);
    } catch (e) {
      if (!isCurrent()) return;
      errorState(this.out, (e as Error).message);
    }
  }

  /** Redessine sans rechercher : la plage horaire a changé, pas le trajet. */
  private rerender(): void {
    const from = this.pair.fromValue;
    const to = this.pair.toValue;
    if (!from || !to || !this.journeys.length) return;
    this.render(from, to, this.dateInput.value, this.journeys);
  }

  private render(from: string, to: string, date: string, all: Journey[]): void {
    const journeys = all.filter((j) =>
      withinHours(j.departure, j.arrival, j.arrivesNextDay, hourFilter.value),
    );
    const hidden = all.length - journeys.length;
    const directs = journeys.filter((j) => j.transfers === 0).length;
    clear(this.summary).appendChild(
      el("div", {
        class: "sum-line",
        html:
          `<b>${prettyStation(from)}</b> → <b>${prettyStation(to)}</b> · ${frDateLong(date)} · ` +
          (journeys.length
            ? `<span class="ok">${journeys.length} itinéraire${journeys.length > 1 ? "s" : ""}</span>` +
              (directs
                ? ` dont ${directs} direct${directs > 1 ? "s" : ""}`
                : " (aucun direct avec place MAX)")
            : `<span class="ko">aucun itinéraire</span> avec place MAX, même avec correspondances`) +
          hoursNote(hidden),
      }),
    );
    clear(this.out);
    if (!journeys.length) {
      empty(
        this.out,
        hidden
          ? "Rien dans cette plage horaire, même en changeant de train."
          : "Rien ce jour-là, même en changeant de train.",
        hidden
          ? "Élargissez la plage horaire, ou visez un autre jour."
          : Number(this.legsSelect.value) < 4
            ? "Vous pouvez autoriser une correspondance de plus, ou viser un autre jour."
            : DATASET_WINDOW,
        {
          label: "Essayer le lendemain",
          onClick: () => {
            this.dateInput.value = iso(addDays(parseISO(date), 1));
            void this.run();
          },
        },
      );
      return;
    }
    for (const j of journeys) this.out.appendChild(this.card(j));
  }

  private card(j: Journey): HTMLElement {
    const header = el("div", { class: "rt-date" }, [
      el("b", {
        html: `${j.departure} <span class="arrow">→</span> ${j.arrival}${j.arrivesNextDay ? ' <span class="t-j1">J+1</span>' : ""}`,
      }),
      el("span", { class: "jy-total", text: formatDuration(j.totalMinutes) }),
      el("span", {
        class: "jy-transfers" + (j.transfers ? "" : " jy-direct"),
        text: j.transfers ? `${j.transfers} corresp.` : "direct",
      }),
    ]);
    const legsBox = el("div", { class: "rt-legs" });
    const waits = transferWaits(j);
    j.legs.forEach((t, i) => {
      if (i > 0) {
        legsBox.appendChild(
          el("div", {
            class: "jy-wait",
            text: `⏱ ${formatDuration(waits[i - 1])} de correspondance à ${prettyStation(t.origin)}`,
          }),
        );
      }
      legsBox.appendChild(
        el("div", { class: "rt-leg" }, [
          el("span", {
            class: "rt-od",
            text: `${prettyStation(t.origin)} → ${prettyStation(t.destination)}`,
          }),
          el("span", { class: "rt-time", html: `<b>${t.departure}</b> → <b>${t.arrival}</b>` }),
          el("span", {
            class: "t-dur",
            text: formatDuration(durationMinutes(t.departure, t.arrival)),
          }),
          axisBadge(t.axis),
          nextDayChip(t),
          el("span", { class: "t-no", text: `n°${t.trainNo}` }),
          legReserveLink(t, this.dateInput.value),
        ]),
      );
    });
    // Un direct se réserve d'un bloc ; une correspondance se réserve jambe par
    // jambe, et le bouton global n'aurait alors plus rien à désigner.
    const footer = j.transfers
      ? el("div", {
          class: "jy-book-note",
          text: "Chaque train se réserve séparément : un billet MAX par jambe.",
        })
      : reserveButton(
          "Réserver ↗",
          bookingUrl(j.legs[0].origin, j.legs[0].destination, this.dateInput.value),
        );
    return el("div", { class: "rt-card" }, [header, legsBox, footer]);
  }
}
