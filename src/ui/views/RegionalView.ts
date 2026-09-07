import { NavitiaAuthError } from "@/data/NavitiaApiClient";
import type { NavitiaKeyStore } from "@/data/NavitiaKeyStore";
import type { RegionalRepository } from "@/data/RegionalRepository";
import type { StationRepository } from "@/data/StationRepository";
import type { MixedJourney, MixedLeg } from "@/domain/models";
import { formatDuration } from "@/domain/time";
import { frDateLong, iso, today } from "@/lib/dates";
import { formatEuros, parseEuros } from "@/lib/money";
import { prettyStation } from "@/lib/text";
import { NavitiaKeyBox } from "../components/NavitiaKeyBox";
import { StationPicker } from "../components/StationPicker";
import { empty, errorState, hint, loading } from "../components/states";
import { reserveButton } from "../components/trains";
import { button, clear, el, field, select } from "../dom";
import type { View } from "./View";

const DEFAULT_BUDGET = "20";

/**
 * « TER + MAX » : door-to-door journeys mixing free MAX seats and paid regional
 * trains, kept under a budget. The MAX legs cost nothing, so the ceiling only
 * applies to what is left — typically the TER used to reach a TGV station.
 */
export class RegionalView implements View {
  readonly id = "regional";
  readonly label = "TER + MAX";
  readonly emoji = "🚈";
  readonly hint = "trajets mixtes sous budget";
  readonly element: HTMLElement;

  private readonly fromPicker: StationPicker;
  private readonly toPicker: StationPicker;
  private readonly dateInput: HTMLInputElement;
  private readonly timeInput: HTMLInputElement;
  private readonly budgetInput: HTMLInputElement;
  private readonly transfersSelect: HTMLSelectElement;
  private readonly sortSelect: HTMLSelectElement;
  private readonly unpricedToggle: HTMLInputElement;
  private readonly keyBox: NavitiaKeyBox;
  private readonly summary = el("div", { class: "summary" });
  private readonly out = el("div", { class: "rt-list" });
  private loaded = false;

  constructor(
    private readonly repo: RegionalRepository,
    stations: StationRepository,
    keys: NavitiaKeyStore,
  ) {
    this.keyBox = new NavitiaKeyBox(keys, () => void this.run());
    this.fromPicker = new StationPicker(stations, {
      placeholder: "ex. Besançon",
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

    this.dateInput = el("input", {
      class: "date-input",
      type: "date",
      min: iso(today()),
      value: iso(today()),
    });
    this.dateInput.addEventListener("change", () => void this.run());

    this.timeInput = el("input", { class: "date-input", type: "time", value: "07:00" });
    this.timeInput.addEventListener("change", () => void this.run());

    this.budgetInput = el("input", {
      class: "date-input budget-input",
      type: "number",
      min: "0",
      step: "1",
      value: DEFAULT_BUDGET,
      inputmode: "decimal",
    });
    this.budgetInput.addEventListener("change", () => void this.run());

    this.transfersSelect = select(
      [
        ["0", "direct seulement"],
        ["1", "1 correspondance"],
        ["2", "2 correspondances"],
        ["3", "3 correspondances"],
      ],
      () => void this.run(),
    );
    this.transfersSelect.value = "2";

    this.sortSelect = select(
      [
        ["price", "le moins cher"],
        ["duration", "le plus rapide"],
      ],
      () => void this.run(),
    );

    this.unpricedToggle = el("input", { type: "checkbox", class: "chk" });
    this.unpricedToggle.addEventListener("change", () => void this.run());

    const controls = el("div", { class: "controls" }, [
      field("Départ", this.fromPicker.element),
      swap,
      field("Arrivée", this.toPicker.element),
      field("Date", this.dateInput),
      field("Partir après", this.timeInput),
      field("Budget max (€)", this.budgetInput),
      field("Jusqu'à", this.transfersSelect),
      field("Trier par", this.sortSelect),
      el("label", { class: "f f-chk" }, [
        el("span", { class: "f-lab", text: "Prix inconnus" }),
        el("span", { class: "chk-row" }, [this.unpricedToggle, el("span", { text: "masquer" })]),
      ]),
      button("Chercher", "btn-primary", () => void this.run()),
    ]);

    this.element = el("section", { class: "panel" }, [
      this.keyBox.element,
      controls,
      hint(
        "Le budget ne compte que ce que vous payez vraiment : les trains où il reste une place MAX " +
          "sont à 0 €, seuls les TER et les trains sans place MAX consomment le budget.",
      ),
      this.summary,
      this.out,
    ]);
  }

  activate(): void {
    // `run()` gère lui-même l'absence de clé (message explicite, aucun appel réseau),
    // sinon le panneau resterait vide sous les contrôles.
    if (!this.loaded) void this.run();
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
    if (!this.keyBox.hasKey) {
      clear(this.summary);
      empty(this.out, "Ajoutez votre clé API SNCF ci-dessus pour chercher des trajets TER.");
      return;
    }
    const from = this.fromPicker.station;
    const to = this.toPicker.station;
    const date = this.dateInput.value;
    const budgetCents = parseEuros(this.budgetInput.value);
    if (!from || !to || from.name === to.name || !date) {
      clear(this.out);
      empty(this.summary, "Choisissez deux gares différentes et une date.");
      return;
    }
    if (budgetCents == null) {
      clear(this.out);
      empty(this.summary, "Budget invalide : entrez un montant en euros.");
      return;
    }

    loading(this.out, "Recherche des itinéraires TER + TGV MAX…");
    clear(this.summary);
    try {
      const journeys = await this.repo.search({
        from,
        to,
        date,
        time: this.timeInput.value || "00:00",
        budgetCents,
        maxTransfers: Number(this.transfersSelect.value),
        dropUnpriced: this.unpricedToggle.checked,
        sort: this.sortSelect.value === "duration" ? "duration" : "price",
      });
      this.loaded = true;
      this.render(from.name, to.name, date, budgetCents, journeys);
    } catch (e) {
      if (e instanceof NavitiaAuthError) {
        this.keyBox.render();
        errorState(this.out, `${(e as Error).message} Saisissez-en une nouvelle ci-dessus.`);
        return;
      }
      errorState(this.out, (e as Error).message);
    }
  }

  private render(
    from: string,
    to: string,
    date: string,
    budgetCents: number,
    journeys: MixedJourney[],
  ): void {
    const cheapest = journeys.find((j) => j.paidCents != null)?.paidCents;
    clear(this.summary).appendChild(
      el("div", {
        class: "sum-line",
        html:
          `<b>${prettyStation(from)}</b> → <b>${prettyStation(to)}</b> · ${frDateLong(date)} · ` +
          `budget ${formatEuros(budgetCents)} · ` +
          (journeys.length
            ? `<span class="ok">${journeys.length} itinéraire${journeys.length > 1 ? "s" : ""}</span>` +
              (cheapest != null ? ` à partir de <b>${formatEuros(cheapest)}</b>` : "")
            : `<span class="ko">aucun itinéraire</span> sous ce budget`),
      }),
    );

    clear(this.out);
    if (!journeys.length) {
      empty(
        this.out,
        "Rien sous ce budget. Montez le plafond, autorisez plus de correspondances, ou changez d'horaire.",
      );
      return;
    }
    for (const journey of journeys) this.out.appendChild(this.card(journey));
  }

  private card(j: MixedJourney): HTMLElement {
    const header = el("div", { class: "rt-date" }, [
      el("b", {
        html:
          `${j.departure} <span class="arrow">→</span> ${j.arrival}` +
          (j.arrivesNextDay ? ' <span class="t-j1">J+1</span>' : ""),
      }),
      el("span", { class: "jy-total", text: formatDuration(j.totalMinutes) }),
      el("span", {
        class: "jy-transfers" + (j.transfers ? "" : " jy-direct"),
        text: j.transfers ? `${j.transfers} corresp.` : "direct",
      }),
      this.priceChip(j),
    ]);

    const legsBox = el(
      "div",
      { class: "rt-legs" },
      j.legs.map((leg) => this.legRow(leg)),
    );

    const notes: HTMLElement[] = [];
    if (j.maxLegs) {
      notes.push(
        el("p", {
          class: "hint",
          text: `${j.maxLegs} trajet${j.maxLegs > 1 ? "s" : ""} à 0 € grâce à une place MAX — à confirmer sur SNCF Connect, les quotas partent vite.`,
        }),
      );
    }
    if (j.unpricedLegs) {
      notes.push(
        el("p", {
          class: "hint",
          text: `${j.unpricedLegs} trajet${j.unpricedLegs > 1 ? "s" : ""} sans tarif renvoyé par l'API : le total est incomplet.`,
        }),
      );
    }
    if (j.walkMinutes) {
      notes.push(el("p", { class: "hint", text: `≈ ${j.walkMinutes} min à pied / de battement.` }));
    }

    return el("div", { class: "rt-card" }, [header, legsBox, ...notes, reserveButton()]);
  }

  /** Total actually payable, or a warning when a leg has no fare. */
  private priceChip(j: MixedJourney): HTMLElement {
    if (j.paidCents == null)
      return el("span", { class: "price price-unknown", text: "prix partiel" });
    if (j.paidCents === 0)
      return el("span", { class: "price price-free", text: "0 € · 100 % MAX" });
    return el("span", { class: "price", text: formatEuros(j.paidCents) });
  }

  private legRow(leg: MixedLeg): HTMLElement {
    const price = leg.maxSeat
      ? el("span", { class: "price price-free", text: "MAX · 0 €" })
      : leg.priceCents != null
        ? el("span", { class: "price", text: formatEuros(leg.priceCents) })
        : el("span", { class: "price price-unknown", text: "tarif ?" });

    return el("div", { class: `rt-leg leg-${leg.category}` }, [
      el("span", { class: `mode mode-${leg.category}`, text: leg.mode }),
      el("span", {
        class: "rt-od",
        text: `${prettyStation(leg.origin)} → ${prettyStation(leg.destination)}`,
      }),
      el("span", { class: "rt-time", html: `<b>${leg.departure}</b> → <b>${leg.arrival}</b>` }),
      el("span", { class: "t-dur", text: formatDuration(leg.minutes) }),
      leg.trainNo ? el("span", { class: "t-no", text: `n°${leg.trainNo}` }) : null,
      price,
    ]);
  }
}
