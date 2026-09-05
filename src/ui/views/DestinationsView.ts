import { FreePlacesRepository } from "@/data/FreePlacesRepository";
import type { StationRepository } from "@/data/StationRepository";
import type { TgvmaxRepository } from "@/data/TgvmaxRepository";
import { bookingUrl } from "@/domain/booking";
import { isOpen, trainWithinHours } from "@/domain/hours";
import type { DestinationAvailability, OriginAvailability, Train } from "@/domain/models";
import { reachableFrom, type Journey } from "@/domain/connections";
import { durationMinutes, formatDuration } from "@/domain/time";
import { addDays, frDateLong, iso, nextSaturday, parseISO, today } from "@/lib/dates";
import { formatRidership } from "@/lib/format";
import { prettyStation } from "@/lib/text";
import { Latest } from "@/lib/latest";
import { flag } from "../components/flags";
import { hourFields, hourFilter } from "../components/hours";
import { rememberedSelect } from "../components/options";
import { StationPicker } from "../components/StationPicker";
import { DATASET_WINDOW, empty, errorState, skeleton } from "../components/states";
import { legReserveLink, reserveButton, trainRow } from "../components/trains";
import { button, clear, el, field } from "../dom";
import type { View } from "./View";

type SortKey = "trains" | "dur" | "pop" | "confid" | "abc";
type Mode = "from" | "to";

interface GroupedStation {
  name: string;
  trains: number;
  firstDeparture: string;
  fastestMinutes: number;
  list: Train[];
  /**
   * Le meilleur trajet avec correspondance vers cette gare, quand elle n'est
   * atteignable qu'en changeant de train. Absent pour les liaisons directes.
   */
  via?: Journey;
}

/**
 * Toutes les destinations avec une place MAX depuis une gare — ou, en mode
 * « Vers une gare », tous les départs qui mènent à une gare choisie.
 */
export class DestinationsView implements View {
  readonly id = "destinations";
  readonly label = "Où aller ?";
  readonly emoji = "🧭";
  readonly hint = "destinations & départs";
  readonly element: HTMLElement;
  onStateChange?: () => void;

  private readonly picker: StationPicker;
  private readonly modeSelect: HTMLSelectElement;
  private readonly stationFieldLabel: HTMLSpanElement;
  private readonly dateInput: HTMLInputElement;
  private readonly sortSelect: HTMLSelectElement;
  private readonly durSelect: HTMLSelectElement;
  private readonly viaSelect: HTMLSelectElement;
  private readonly summary = el("div", { class: "summary" });
  private readonly out = el("div", { class: "dest-grid" });
  private results: GroupedStation[] = [];
  private loaded = false;
  /** Deux recherches peuvent se croiser : seule la dernière écrit à l'écran. */
  private readonly latest = new Latest();

  constructor(
    private readonly repo: TgvmaxRepository,
    private readonly stations: StationRepository,
    private readonly freePlaces?: FreePlacesRepository,
  ) {
    this.picker = new StationPicker(stations, {
      placeholder: "ex. Paris",
      value: "PARIS (intramuros)",
      onSelect: () => void this.run(),
    });
    this.modeSelect = rememberedSelect(
      "ouAller.mode",
      [
        ["from", "Depuis une gare"],
        ["to", "Vers une gare"],
      ],
      "from",
      () => {
        this.stationFieldLabel.textContent = this.mode() === "to" ? "Arrivée" : "Départ";
        this.toggleViaField();
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
    this.durSelect = rememberedSelect(
      "ouAller.duree",
      [
        ["0", "Toute durée"],
        ["120", "≤ 2h"],
        ["180", "≤ 3h"],
        ["240", "≤ 4h"],
        ["360", "≤ 6h"],
      ],
      "0",
      () => this.render(),
    );
    this.sortSelect = rememberedSelect(
      "ouAller.tri",
      [
        ["trains", "Plus de trains"],
        ["dur", "Trajet le plus court"],
        ["pop", "Les plus fréquentées"],
        ["confid", "Les plus confidentielles"],
        ["abc", "A → Z"],
      ],
      "trains",
      () => this.render(),
    );

    // Les correspondances ouvrent des destinations que le direct n'atteint pas.
    // Elles reposent sur le chargement de tous les trains du jour, et la
    // recherche part de la gare choisie : elles n'ont donc de sens qu'en mode
    // « Depuis une gare ».
    this.viaSelect = rememberedSelect(
      "ouAller.via",
      [
        ["1", "Trajets directs"],
        ["2", "Jusqu'à 1 correspondance"],
        ["3", "Jusqu'à 2 correspondances"],
      ],
      "1",
      () => void this.run(),
    );

    // Comme sur la carte : l'intitulé doit correspondre au mode retenu.
    this.stationFieldLabel = el("span", {
      class: "f-lab",
      text: this.mode() === "to" ? "Arrivée" : "Départ",
    });
    const stationField = el("label", { class: "f" }, [this.stationFieldLabel, this.picker.element]);
    const controls = el("div", { class: "controls" }, [
      field("Mode", this.modeSelect),
      stationField,
      field("Date", this.dateInput),
      field("Correspondances", this.viaSelect),
      field("Trajet max", this.durSelect),
      field("Trier par", this.sortSelect),
      ...hourFields(),
      button("Chercher", "btn-primary", () => void this.run()),
    ]);
    const chips = el("div", { class: "chips" }, [
      button("Aujourd'hui", "chip", () => this.setDate(today())),
      button("Demain", "chip", () => this.setDate(addDays(today(), 1))),
      button("Ce week-end", "chip", () => this.setDate(nextSaturday())),
      button("🎲 Surprends-moi", "chip chip-accent", () => this.surprise()),
    ]);
    this.element = el("section", { class: "panel" }, [controls, chips, this.summary, this.out]);
    this.toggleViaField();
    // Plage horaire commune : le tri et le filtrage se refont sur les résultats
    // déjà chargés, sans nouvelle requête.
    hourFilter.subscribe(() => {
      if (this.loaded) this.render();
    });
  }

  /** Le réglage des correspondances n'a de sens qu'en mode « Depuis une gare ». */
  private toggleViaField(): void {
    const wrapper = this.viaSelect.parentElement;
    if (wrapper) wrapper.style.display = this.mode() === "to" ? "none" : "";
  }

  /** Nombre maximal de trains par trajet ; `1` = direct seulement. */
  private maxLegs(): number {
    return this.mode() === "to" ? 1 : Number(this.viaSelect.value);
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

  /** Le sens, la gare et le jour : de quoi rejouer la recherche à l'identique. */
  state(): Record<string, string> {
    return {
      mode: this.mode(),
      station: this.picker.value ?? "",
      date: this.dateInput.value,
    };
  }

  restore(params: Record<string, string>): void {
    if (params.mode === "to" || params.mode === "from") {
      this.modeSelect.value = params.mode;
      this.stationFieldLabel.textContent = params.mode === "to" ? "Arrivée" : "Départ";
      this.toggleViaField();
    }
    if (params.station) this.picker.set(params.station);
    if (params.date) this.dateInput.value = params.date;
    this.loaded = false; // `activate` relancera la recherche
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
      this.latest.cancel();
      empty(this.summary, "Choisissez une gare et une date.");
      clear(this.out);
      return;
    }
    const maxLegs = this.maxLegs();
    const isCurrent = this.latest.begin();
    skeleton(this.out, "cards", 8);
    clear(this.summary);
    this.onStateChange?.();
    try {
      const grouped =
        this.mode() === "to"
          ? ((await this.repo.originsOn(station, date)) as OriginAvailability[])
          : ((await this.repo.destinationsOn(station, date)) as DestinationAvailability[]);
      // Le verdict avant l'affectation : une réponse périmée ne doit pas non
      // plus rester en mémoire, sinon un simple changement de tri la ferait
      // ressurgir à l'écran.
      if (!isCurrent()) return;
      const direct: GroupedStation[] = grouped.map((r) => ({
        name: "origin" in r ? r.origin : r.destination,
        trains: r.trains,
        firstDeparture: r.firstDeparture,
        fastestMinutes: r.fastestMinutes,
        list: r.list,
      }));
      const full =
        maxLegs > 1 ? await this.withConnections(station, date, direct, maxLegs) : direct;
      // Deuxième vérification : la recherche des correspondances est le plus
      // long des deux chargements, c'est là qu'une recherche plus récente a le
      // plus de chances d'être passée devant.
      if (!isCurrent()) return;
      this.results = full;
      this.loaded = true;
      this.render();
    } catch (e) {
      if (!isCurrent()) return;
      errorState(this.out, (e as Error).message);
    }
  }

  /**
   * Complète les destinations directes par celles qu'on n'atteint qu'en
   * changeant de train.
   *
   * Un seul chargement des trains du jour suffit : le parcours se fait ensuite
   * en mémoire depuis la gare choisie. Interroger l'API destination par
   * destination demanderait autant de requêtes qu'il y a de gares.
   *
   * Une gare déjà desservie en direct n'est pas remplacée : quand le direct
   * existe, c'est lui qu'on veut voir en premier.
   */
  private async withConnections(
    station: string,
    date: string,
    direct: GroupedStation[],
    maxLegs: number,
  ): Promise<GroupedStation[]> {
    const trains = await this.repo.allTrainsOn(date);
    const known = new Set(direct.map((d) => d.name));
    const extra: GroupedStation[] = [];
    for (const r of reachableFrom(trains, station, { maxLegs })) {
      if (r.minTransfers === 0 || known.has(r.station)) continue;
      extra.push({
        name: r.station,
        trains: r.journeys,
        firstDeparture: r.best.departure,
        fastestMinutes: r.best.totalMinutes,
        list: r.best.legs,
        via: r.best,
      });
    }
    return [...direct, ...extra];
  }

  /**
   * Applique la plage horaire à chaque destination.
   *
   * Une destination ne disparaît que si aucun de ses trains ne tient dans la
   * plage ; sinon ses compteurs sont recalculés sur ce qui reste, sans quoi la
   * carte annoncerait huit trajets et n'en montrerait qu'un.
   */
  private inHours(list: GroupedStation[]): GroupedStation[] {
    const window = hourFilter.value;
    if (isOpen(window)) return list;
    return list.flatMap((r) => {
      const kept = r.list.filter((t) => trainWithinHours(t, window));
      if (!kept.length) return [];
      return [
        {
          ...r,
          list: kept,
          trains: kept.length,
          firstDeparture: kept.reduce((min, t) => (t.departure < min ? t.departure : min), "99:99"),
          fastestMinutes: Math.min(...kept.map((t) => durationMinutes(t.departure, t.arrival))),
        },
      ];
    });
  }

  private filtered(): GroupedStation[] {
    const maxDur = Number(this.durSelect.value);
    const list = this.inHours(this.results).filter((r) => !maxDur || r.fastestMinutes <= maxDur);
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

    const via = res.filter((r) => r.via).length;
    clear(this.summary).appendChild(
      el("div", {
        class: "sum-line",
        html:
          `<b>${res.length}</b> ${noun}${res.length > 1 ? "s" : ""} accessible${res.length > 1 ? "s" : ""} avec une place MAX ${to ? "vers" : "depuis"} <b>${prettyStation(station)}</b> · ${frDateLong(date)}` +
          (via ? ` · dont <b>${via}</b> en changeant de train` : ""),
      }),
    );

    clear(this.out);
    if (!res.length) {
      empty(
        this.out,
        "Aucune place MAX ce jour-là.",
        this.results.length
          ? "Le filtre de durée écarte tout ce qui a été trouvé : élargissez-le."
          : DATASET_WINDOW,
        { label: "Essayer le lendemain", onClick: () => this.setDate(addDays(parseISO(date), 1)) },
      );
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
          r.via
            ? el("span", {
                class: "jy-transfers",
                text: `${r.via.transfers} corresp.`,
                title:
                  "Pas de train direct avec place MAX ce jour-là : " +
                  `passage par ${r.via.legs
                    .slice(1)
                    .map((l) => prettyStation(l.origin))
                    .join(", ")}`,
              })
            : null,
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
    const fill = (list: Train[]): void => {
      const date = this.dateInput.value;
      const to = this.mode() === "to";
      clear(body);
      [...list]
        .sort((a, b) => a.departure.localeCompare(b.departure))
        .forEach((t) => {
          const row = trainRow(t);
          // Sur une gare atteinte en correspondance, chaque train se réserve à
          // part : le lien vit donc sur la ligne, pas sur la carte.
          if (r.via) row.appendChild(legReserveLink(t, date));
          body.appendChild(row);
        });
      if (r.via) {
        body.appendChild(
          el("div", {
            class: "jy-book-note",
            text: "Pas de direct ce jour-là : chaque train se réserve séparément.",
          }),
        );
        return;
      }
      const picked = this.picker.value ?? "";
      const [origin, destination] = to ? [r.name, picked] : [picked, r.name];
      body.appendChild(
        reserveButton("Réserver ce trajet ↗", bookingUrl(origin, destination, date)),
      );
    };
    card.querySelector(".dc-head")?.addEventListener("click", () => {
      card.classList.toggle("open");
      if (body.classList.contains("hidden")) {
        body.classList.remove("hidden");
        if (!filled) {
          filled = true;
          fill(r.list);
          // Le nombre de places restantes ne s'interroge qu'à l'ouverture de la
          // carte : une journée compte des dizaines de destinations, les
          // demander toutes reviendrait à marteler le service pour des trajets
          // que personne ne regarde. Une gare atteinte en correspondance est
          // laissée de côté : ses trains sont des liaisons différentes.
          if (!r.via) {
            void this.withSeats(r.name, r.list).then((list) => {
              if (list && !body.classList.contains("hidden")) fill(list);
            });
          }
        }
      } else {
        body.classList.add("hidden");
      }
    });
    return card;
  }

  /**
   * La même liste de trains, avec le nombre de places restantes quand le relais
   * est configuré et qu'il répond. `null` veut dire « rien à ajouter » : la
   * liste déjà affichée reste telle quelle.
   */
  private async withSeats(name: string, list: Train[]): Promise<Train[] | null> {
    if (!this.freePlaces?.enabled) return null;
    const picked = this.picker.value ?? "";
    const [origin, destination] = this.mode() === "to" ? [name, picked] : [picked, name];
    const pair = await this.repo.codePair(origin, destination).catch(() => null);
    if (!pair) return null;
    const day = await this.freePlaces.day(pair[0], pair[1], this.dateInput.value);
    return day ? FreePlacesRepository.attach(list, day) : null;
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
