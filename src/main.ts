import "@/styles/style.css";
import { App } from "@/app/App";
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

/**
 * Service worker : le site reste consultable sans réseau, et s'installe comme
 * une application. En développement il n'a rien à faire là : son cache
 * masquerait les modifications qu'on vient d'écrire.
 */
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  });
}

new App(
  root,
  [
    new CalendarView(trips, stations),
    new DestinationsView(trips, stations),
    new ConnectionsView(trips, stations),
    new MapView(trips, stations),
    new RoundtripView(trips, stations),
  ],
  trips,
  stations,
).mount();
