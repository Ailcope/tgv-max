import "@/styles/style.css";
import { App } from "@/app/App";
import { NavitiaApiClient } from "@/data/NavitiaApiClient";
import { NavitiaKeyStore } from "@/data/NavitiaKeyStore";
import { RegionalRepository } from "@/data/RegionalRepository";
import { SncfApiClient } from "@/data/SncfApiClient";
import { StationRepository } from "@/data/StationRepository";
import { TgvmaxRepository } from "@/data/TgvmaxRepository";
import { CalendarView } from "@/ui/views/CalendarView";
import { ConnectionsView } from "@/ui/views/ConnectionsView";
import { DestinationsView } from "@/ui/views/DestinationsView";
import { MapView } from "@/ui/views/MapView";
import { RegionalView } from "@/ui/views/RegionalView";
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

// Mode « trains régionaux » : autre API (SNCF Navitia), qui demande un token
// utilisateur — d'où le magasin de clés injecté jusque dans la vue.
const navitiaKeys = new NavitiaKeyStore();
const regional = new RegionalRepository(new NavitiaApiClient(() => navitiaKeys.get()), trips);

new App(
  root,
  [
    new CalendarView(trips, stations),
    new DestinationsView(trips, stations),
    new ConnectionsView(trips, stations),
    new MapView(trips, stations),
    new RoundtripView(trips, stations),
    new RegionalView(regional, stations, navitiaKeys),
  ],
  trips,
  stations,
).mount();
