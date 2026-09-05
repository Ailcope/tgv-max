import "@/styles/style.css";
import { App } from "@/app/App";
import { FreePlacesRepository } from "@/data/FreePlacesRepository";
import { SncfApiClient } from "@/data/SncfApiClient";
import { StationRepository } from "@/data/StationRepository";
import { TgvmaxRepository } from "@/data/TgvmaxRepository";
import { CalendarView } from "@/ui/views/CalendarView";
import { ConnectionsView } from "@/ui/views/ConnectionsView";
import { DestinationsView } from "@/ui/views/DestinationsView";
import { MapView } from "@/ui/views/MapView";
import { RoundtripView } from "@/ui/views/RoundtripView";

/**
 * Composition root: build the dependency graph and start the app.
 * Everything downstream receives its collaborators via the constructor, so the
 * wiring lives here and nowhere else.
 */
const root = document.getElementById("app");
if (!root) throw new Error("Élément #app introuvable");

const api = new SncfApiClient();
const trips = new TgvmaxRepository(api);
const stations = new StationRepository();
// Nombre de places restantes : actif seulement si un relais est configuré
// (VITE_FREEPLACES_RELAY). Sans lui, les vues affichent ce qu'elles affichaient.
const freePlaces = new FreePlacesRepository();

new App(
  root,
  [
    new CalendarView(trips, stations, freePlaces),
    new DestinationsView(trips, stations, freePlaces),
    new ConnectionsView(trips, stations),
    new MapView(trips, stations),
    new RoundtripView(trips, stations),
  ],
  trips,
  stations,
).mount();
