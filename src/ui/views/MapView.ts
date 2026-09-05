import * as L from "leaflet";
import { SNCF_CONNECT_SEARCH } from "@/config";
import type { StationRepository } from "@/data/StationRepository";
import type { TgvmaxRepository } from "@/data/TgvmaxRepository";
import type { Station } from "@/domain/models";
import { formatDuration } from "@/domain/time";
import { addDays, frDateLong, iso, today } from "@/lib/dates";
import { prettyStation } from "@/lib/text";
import { StationPicker } from "../components/StationPicker";
import { hint } from "../components/states";
import { clear, el, field, select } from "../dom";
import { ACCENT, createMap, destIcon, type MapHandle, originIcon } from "../map/MapKit";
import type { View } from "./View";

interface MapDatum {
  station: string;
  metric: number;
  label: string;
  first?: string;
  fastestMinutes?: number;
}

type Mode = "from" | "to";

/** Geographic view of reachable destinations over the real rail network. */
export class MapView implements View {
  readonly id = "map";
  readonly label = "Carte";
  readonly emoji = "🗺️";
  readonly hint = "vue géographique";
  readonly element: HTMLElement;

  private readonly picker: StationPicker;
  private readonly modeSelect: HTMLSelectElement;
  private readonly stationFieldLabel: HTMLSpanElement;
  private readonly scopeSelect: HTMLSelectElement;
  private readonly dateInput: HTMLInputElement;
  private readonly summary = el("div", { class: "summary" });
  private readonly mapEl = el("div", { class: "map" });
  private readonly handle: MapHandle;
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
        this.stationFieldLabel.textContent = this.modeSelect.value === "to" ? "Arrivée" : "Départ";
        void this.run();
      },
    );
    this.dateInput = el("input", {
      class: "date-input",
      type: "date",
      min: iso(today()),
      value: iso(addDays(today(), 1)),
    });
    this.dateInput.addEventListener("change", () => {
      if (this.scopeSelect.value === "date") void this.run();
    });
    this.scopeSelect = select(
      [
        ["range", "30 prochains jours"],
        ["date", "Une date précise"],
      ],
      () => {
        this.toggleDateField();
        void this.run();
      },
    );

    this.stationFieldLabel = el("span", { class: "f-lab", text: "Départ" });
    const stationField = el("label", { class: "f" }, [this.stationFieldLabel, this.picker.element]);
    const controls = el("div", { class: "controls" }, [
      field("Mode", this.modeSelect),
      stationField,
      field("Période", this.scopeSelect),
      field("Date", this.dateInput),
      el("button", {
        class: "btn-primary",
        text: "Afficher la carte",
        onclick: () => void this.run(),
      }),
    ]);
    this.element = el("section", { class: "panel" }, [
      controls,
      this.summary,
      el("div", { class: "map-wrap" }, [this.mapEl]),
      hint(
        "Survolez une gare pour la mettre en avant, cliquez pour les détails. Le fond montre les vraies lignes SNCF, colorées par vitesse (LGV en rose) ; les couches se règlent en haut à droite.",
      ),
    ]);

    this.handle = createMap(this.mapEl, { zoom: 6 });
    this.toggleDateField();
  }

  activate(): void {
    if (!this.loaded) void this.run();
    setTimeout(() => this.handle.map.invalidateSize(), 60);
  }

  private toggleDateField(): void {
    const dateField = this.dateInput.parentElement;
    if (dateField) dateField.style.display = this.scopeSelect.value === "date" ? "" : "none";
  }

  private mode(): Mode {
    return this.modeSelect.value as Mode;
  }

  private async run(): Promise<void> {
    const stationName = this.picker.value;
    if (!stationName) return;
    const station = this.stations.get(stationName);
    if (!station) return;
    const mode = this.mode();
    clear(this.summary).appendChild(hint("Chargement de la carte…"));
    try {
      const byDate = this.scopeSelect.value === "date";
      const data: MapDatum[] = [];
      if (mode === "from") {
        if (byDate) {
          const rs = await this.repo.destinationsOn(stationName, this.dateInput.value);
          for (const r of rs) {
            data.push({
              station: r.destination,
              metric: r.trains,
              label: `${r.trains} trajet(s)`,
              first: r.firstDeparture,
              fastestMinutes: r.fastestMinutes,
            });
          }
        } else {
          const rs = await this.repo.destinationsRange(stationName);
          for (const r of rs) {
            data.push({ station: r.destination, metric: r.days, label: `${r.days} jour(s) · ${r.trains} trajet(s)` });
          }
        }
      } else if (byDate) {
        const rs = await this.repo.originsOn(stationName, this.dateInput.value);
        for (const r of rs) {
          data.push({
            station: r.origin,
            metric: r.trains,
            label: `${r.trains} trajet(s)`,
            first: r.firstDeparture,
            fastestMinutes: r.fastestMinutes,
          });
        }
      } else {
        const rs = await this.repo.originsRange(stationName);
        for (const r of rs) {
          data.push({ station: r.origin, metric: r.days, label: `${r.days} jour(s) · ${r.trains} trajet(s)` });
        }
      }
      this.loaded = true;
      this.draw(stationName, station, data, byDate, mode);
    } catch (e) {
      clear(this.summary).appendChild(hint(`Erreur : ${(e as Error).message}`));
    }
  }

  private draw(
    stationName: string,
    station: Station,
    data: MapDatum[],
    byDate: boolean,
    mode: Mode,
  ): void {
    this.handle.routes.clearLayers();
    this.handle.markers.clearLayers();
    const points: L.LatLngTuple[] = [[station.lat, station.lon]];
    const maxMetric = Math.max(1, ...data.map((d) => d.metric));

    const anchorIcon = mode === "to" ? destIcon() : originIcon();
    L.marker([station.lat, station.lon], { icon: anchorIcon, zIndexOffset: 1000 })
      .addTo(this.handle.markers)
      .bindTooltip(`${prettyStation(stationName)} · ${mode === "to" ? "arrivée" : "départ"}`, {
        direction: "top",
      });

    for (const d of data) {
      const s = this.stations.get(d.station);
      if (!s) continue;
      points.push([s.lat, s.lon]);
      const marker = L.circleMarker([s.lat, s.lon], {
        radius: 5 + 13 * Math.sqrt(d.metric / maxMetric),
        color: "#fff",
        weight: 1.5,
        fillColor: heat(d.metric / maxMetric),
        fillOpacity: 0.9,
      })
        .addTo(this.handle.markers)
        .bindTooltip(`${prettyStation(d.station)} · ${d.label}`, { direction: "top" })
        .bindPopup(popupHtml(d));
      marker.on("mouseover", () => marker.setStyle({ color: ACCENT, weight: 3 }));
      marker.on("mouseout", () => marker.setStyle({ color: "#fff", weight: 1.5 }));
    }

    if (points.length > 1) this.handle.map.fitBounds(points, { padding: [40, 40] });
    const noun = mode === "to" ? "gare de départ" : "destination";
    clear(this.summary).appendChild(
      el("div", {
        class: "sum-line",
        html:
          `<b>${data.length}</b> ${noun}${data.length > 1 ? "s" : ""} avec place MAX ${mode === "to" ? "vers" : "depuis"} <b>${prettyStation(stationName)}</b> · ` +
          (byDate ? frDateLong(this.dateInput.value) : "30 prochains jours") +
          (data.length ? "" : ' · <span class="ko">rien trouvé</span>'),
      }),
    );
    this.handle.map.invalidateSize();
  }
}

const heat = (t: number): string => (t > 0.66 ? "#1a8a3f" : t > 0.33 ? "#4caf50" : "#a5d6a7");

function popupHtml(d: MapDatum): string {
  const dur = d.fastestMinutes ? ` · ${formatDuration(d.fastestMinutes)}` : "";
  const departure = d.first ? `<br>dès ${d.first}${dur}` : "";
  return `<div class="pop"><b>${prettyStation(d.station)}</b><br>${d.label}${departure}<br><a href="${SNCF_CONNECT_SEARCH}" target="_blank" rel="noopener">Réserver ↗</a></div>`;
}
