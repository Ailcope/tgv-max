import { TGVMAX_DATASET } from "@/config";
import type { DatasetMeta, RecordsResponse } from "./dto";

/** A `fetch`-compatible function (injectable for testing). */
export type FetchFn = typeof fetch;

/** Maximum de lignes rendues par appel, imposé par l'API. */
const PAGE_SIZE = 100;

/** Pages demandées de front : assez pour charger une journée en quelques
 *  secondes, assez peu pour rester poli avec une API publique et gratuite. */
const PAGE_CONCURRENCY = 6;

export interface RecordsQuery {
  select?: string;
  groupBy?: string;
  orderBy?: string;
  limit?: number;
  offset?: number;
}

/**
 * Thin, typed client over the OpenDataSoft Explore v2.1 API.
 * `fetch` is injected so the query-building and pagination logic is unit-testable.
 */
export class SncfApiClient {
  constructor(
    // Wrapped so the global `fetch` keeps its `window` binding when stored on `this`.
    private readonly fetchFn: FetchFn = (input, init) => fetch(input, init),
    private readonly base: string = TGVMAX_DATASET,
  ) {}

  /** Build the records URL for a `where` clause and query options (pure). */
  buildUrl(where: string, q: RecordsQuery = {}): string {
    const p = new URLSearchParams();
    p.set("where", where);
    if (q.select) p.set("select", q.select);
    if (q.groupBy) p.set("group_by", q.groupBy);
    if (q.orderBy) p.set("order_by", q.orderBy);
    p.set("limit", String(q.limit ?? 100));
    if (q.offset) p.set("offset", String(q.offset));
    return `${this.base}/records?${p.toString()}`;
  }

  async records<T>(where: string, q: RecordsQuery = {}): Promise<RecordsResponse<T>> {
    const res = await this.fetchFn(this.buildUrl(where, q));
    if (!res.ok) throw new Error(`SNCF API ${res.status}`);
    return (await res.json()) as RecordsResponse<T>;
  }

  /**
   * Fetch every row for a query, paginating up to `cap`.
   *
   * L'API rend cent lignes au maximum par appel, mais annonce le total dès la
   * première réponse : les pages suivantes sont donc demandées de front plutôt
   * qu'une par une. Une journée entière du jeu de données, c'est une soixantaine
   * de pages ; en série, l'attente devenait telle qu'il fallait s'arrêter avant
   * la fin, et une fenêtre tronquée se lit comme une absence de train.
   *
   * L'ordre est celui des offsets, pas celui des réponses : le tri demandé à
   * l'API doit se retrouver dans le résultat.
   *
   * Deux régimes, selon ce que vaut `total_count`. Sur une requête ordinaire il
   * annonce le nombre de lignes, et toutes les pages peuvent être demandées
   * d'un coup. Sur une requête agrégée (`group_by`) il ne compte que la page
   * rendue : il n'annonce rien, et croire ce chiffre revient à s'arrêter à la
   * centième ligne. On avance alors par vagues, jusqu'à une page incomplète.
   */
  async all<T>(where: string, q: RecordsQuery = {}, cap = 2000): Promise<T[]> {
    const first = await this.records<T>(where, { ...q, limit: PAGE_SIZE });
    if (first.results.length < PAGE_SIZE) return first.results;

    const rest =
      first.total_count > first.results.length
        ? await this.byTotal<T>(where, q, Math.min(first.total_count, cap))
        : await this.byWaves<T>(where, q, cap);
    return [first.results, ...rest].flat().slice(0, cap);
  }

  /** Pages suivantes quand le total est connu : toutes demandées de front. */
  private async byTotal<T>(where: string, q: RecordsQuery, total: number): Promise<T[][]> {
    const offsets: number[] = [];
    for (let offset = PAGE_SIZE; offset < total; offset += PAGE_SIZE) offsets.push(offset);

    const pages: T[][] = Array.from({ length: offsets.length }, () => []);
    let next = 0;
    const worker = async (): Promise<void> => {
      for (let i = next++; i < offsets.length; i = next++) {
        const { results } = await this.records<T>(where, {
          ...q,
          limit: PAGE_SIZE,
          offset: offsets[i],
        });
        pages[i] = results;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(PAGE_CONCURRENCY, offsets.length) }, () => worker()),
    );
    return pages;
  }

  /** Pages suivantes quand le total est inconnu : par vagues, jusqu'à la fin. */
  private async byWaves<T>(where: string, q: RecordsQuery, cap: number): Promise<T[][]> {
    const pages: T[][] = [];
    const stride = PAGE_SIZE * PAGE_CONCURRENCY;
    for (let start = PAGE_SIZE; start < cap; start += stride) {
      const offsets: number[] = [];
      for (let o = start; o < Math.min(start + stride, cap); o += PAGE_SIZE) offsets.push(o);
      const wave = await Promise.all(
        offsets.map((offset) => this.records<T>(where, { ...q, limit: PAGE_SIZE, offset })),
      );
      pages.push(...wave.map((page) => page.results));
      // Une page incomplète marque la fin : les suivantes seraient vides.
      if (wave.some((page) => page.results.length < PAGE_SIZE)) break;
    }
    return pages;
  }

  /** Dataset metadata (used for the last-refresh timestamp). */
  async datasetMeta(): Promise<DatasetMeta> {
    const res = await this.fetchFn(this.base);
    if (!res.ok) throw new Error(`SNCF API ${res.status}`);
    return (await res.json()) as DatasetMeta;
  }
}
