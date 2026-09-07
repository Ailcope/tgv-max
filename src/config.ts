/** Application-wide constants (endpoints, external links). */

/** OpenDataSoft dataset endpoint for the SNCF « tgvmax » dataset. */
export const TGVMAX_DATASET =
  "https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/tgvmax";

/** Public dataset page (shown in the footer). */
export const TGVMAX_DATASET_PAGE = "https://ressources.data.sncf.com/explore/dataset/tgvmax/";

/** SNCF Connect search page (best-effort booking deep link). */
export const SNCF_CONNECT_SEARCH = "https://www.sncf-connect.com/app/home/search";

/** Simplified rail-network GeoJSON, served from `public/`. */
export const RAILNET_URL = `${import.meta.env.BASE_URL}railnet.geojson`;

/** Donation page (Ko-fi). */
export const KOFI_URL = "https://ko-fi.com/snownamida";

/** Ko-fi embeddable panel (official iframe embed, stays on our site). */
export const KOFI_EMBED_URL = "https://ko-fi.com/snownamida/?hidefeed=true&widget=true&embed=true";

/* ---- Trains régionaux (TER) : API SNCF « Navitia » ---- */

/** Base de l'API SNCF (Navitia) — itinéraires TER et tarifs. Nécessite un token. */
export const NAVITIA_BASE = "https://api.sncf.com/v1";

/** Couverture Navitia utilisée (réseau France entière). */
export const NAVITIA_COVERAGE = "sncf";

/** Page où obtenir un token développeur gratuit. */
export const NAVITIA_SIGNUP_URL = "https://numerique.sncf.com/startup/api/token-developpeur/";

/** Clé `localStorage` où le token de l'utilisateur est conservé (jamais envoyé ailleurs). */
export const NAVITIA_KEY_STORAGE = "tgvmax-planner.navitia-key";

/**
 * Modes physiques exclus des recherches régionales : on veut du train (TER,
 * Intercités, TGV), pas du métro / bus urbain / bateau, sinon les itinéraires
 * partent en transport urbain dès que le point de départ est une coordonnée.
 */
export const NAVITIA_FORBIDDEN_MODES = [
  "physical_mode:Metro",
  "physical_mode:Bus",
  "physical_mode:Tramway",
  "physical_mode:Funicular",
  "physical_mode:Ferry",
  "physical_mode:Taxi",
  "physical_mode:Shuttle",
  "physical_mode:BikeSharingService",
] as const;
