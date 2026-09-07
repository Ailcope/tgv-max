import { NAVITIA_BASE, NAVITIA_COVERAGE, NAVITIA_FORBIDDEN_MODES } from "@/config";
import type { NavitiaJourneysResponse } from "./navitiaDto";

/** A `fetch`-compatible function (injectable for testing). */
export type FetchFn = typeof fetch;

/** Supplies the API token; a function so the UI can change it without rewiring. */
export type TokenProvider = () => string | null;

export interface JourneysQuery {
  /** `"lon;lat"` coordinates, or a Navitia object id. */
  from: string;
  to: string;
  /** Local departure time, compact form `"YYYYMMDDTHHMMSS"`. */
  datetime: string;
  /** How many journeys to ask for (Navitia caps this well under 100). */
  count?: number;
  /** Maximum number of connections. */
  maxTransfers?: number;
  /** Physical modes to exclude; defaults to {@link NAVITIA_FORBIDDEN_MODES}. */
  forbiddenModes?: readonly string[];
}

/** Thrown when the API rejects the token, so the UI can offer to fix it. */
export class NavitiaAuthError extends Error {}

/** Basic-auth header value: the token is the user name, with an empty password. */
function basicAuth(token: string): string {
  return `Basic ${btoa(`${token}:`)}`;
}

/**
 * Thin, typed client over the SNCF « Navitia » journey API.
 * `fetch` and the token are injected, so URL building and error mapping are
 * unit-testable without a network or a real key.
 */
export class NavitiaApiClient {
  constructor(
    private readonly token: TokenProvider,
    // Wrapped so the global `fetch` keeps its `window` binding when stored on `this`.
    private readonly fetchFn: FetchFn = (input, init) => fetch(input, init),
    private readonly base: string = NAVITIA_BASE,
    private readonly coverage: string = NAVITIA_COVERAGE,
  ) {}

  /** Build the `/journeys` URL for a query (pure). */
  buildUrl(q: JourneysQuery): string {
    const p = new URLSearchParams();
    p.set("from", q.from);
    p.set("to", q.to);
    p.set("datetime", q.datetime);
    p.set("datetime_represents", "departure");
    p.set("count", String(q.count ?? 8));
    if (q.maxTransfers != null) p.set("max_nb_transfers", String(q.maxTransfers));
    for (const mode of q.forbiddenModes ?? NAVITIA_FORBIDDEN_MODES) {
      p.append("forbidden_uris[]", mode);
    }
    return `${this.base}/coverage/${this.coverage}/journeys?${p.toString()}`;
  }

  /** Journeys between two points, fares included when the API knows them. */
  async journeys(q: JourneysQuery): Promise<NavitiaJourneysResponse> {
    const token = this.token();
    if (!token) throw new NavitiaAuthError("Aucune clé API SNCF enregistrée.");

    // Un échec réseau remonte ici en `TypeError: Failed to fetch`, qui ne dit rien à
    // l'utilisateur — et couvre le cas le plus probable : l'API SNCF injoignable ou
    // un navigateur qui bloque la requête cross-origin.
    let res: Response;
    try {
      res = await this.fetchFn(this.buildUrl(q), {
        headers: { Authorization: basicAuth(token) },
      });
    } catch {
      throw new Error(
        "API SNCF injoignable. Vérifiez votre connexion, ou un bloqueur qui empêcherait l'appel.",
      );
    }
    // Navitia answers 404 with a normal body when it simply found no journey,
    // so the body is read before the status is turned into an error.
    const body = await res.json().catch(() => null as NavitiaJourneysResponse | null);

    if (res.status === 401 || res.status === 403) {
      throw new NavitiaAuthError("Clé API SNCF refusée. Vérifiez votre token.");
    }
    if (body?.error) {
      if (body.error.id === "no_solution") return { journeys: [], tickets: [] };
      throw new Error(body.error.message ?? body.error.id ?? "Erreur de l'API SNCF.");
    }
    if (!res.ok) throw new Error(`API SNCF ${res.status}`);
    return body ?? { journeys: [], tickets: [] };
  }
}
