import { FREEPLACES_RELAY } from "@/config";
import type { DaySeats, SeatsByDate, Train } from "@/domain/models";
import { summarizeDay } from "@/domain/tension";
import type { FreePlacesResponse } from "./dto";
import type { FetchFn } from "./SncfApiClient";

/** Requêtes menées de front : assez pour que 30 jours arrivent vite, assez peu
 *  pour ne pas assommer le relais ni le service qu'il protège. */
const CONCURRENCY = 4;

/** Au-delà, on considère que le relais est cassé et on cesse de le solliciter
 *  pour la durée de la session : mieux vaut perdre l'info que marteler. */
const MAX_CONSECUTIVE_FAILURES = 3;

/**
 * Accès au nombre de places MAX restantes, via un relais vers le service du
 * MAX Planner officiel (voir `ops/freeplaces-relay/`).
 *
 * Toute la classe est conçue pour l'absence : sans relais configuré, ou si le
 * relais tombe, {@link enabled} passe à `false` et les méthodes rendent des
 * résultats vides. L'appelant affiche alors ce qu'il affichait avant : le
 * nombre de places est un bonus, jamais une dépendance.
 */
export class FreePlacesRepository {
  private readonly cache = new Map<string, Promise<DaySeats | null>>();
  private failures = 0;
  private broken = false;

  constructor(
    private readonly base: string = FREEPLACES_RELAY,
    private readonly fetchFn: FetchFn = (input, init) => fetch(input, init),
  ) {}

  /** `false` quand aucun relais n'est configuré, ou qu'il a lâché. */
  get enabled(): boolean {
    return Boolean(this.base) && !this.broken;
  }

  /** URL interrogée pour un O/D et une date (pure, testable). */
  buildUrl(originCode: string, destinationCode: string, date: string): string {
    const p = new URLSearchParams({
      origin: originCode,
      destination: destinationCode,
      // Le service attend un instant complet ; c'est la date qui compte.
      departureDateTime: `${date}T00:00:00.000Z`,
    });
    return `${this.base.replace(/\/$/, "")}/search-freeplaces-proposals?${p.toString()}`;
  }

  /** Places restantes un jour donné, ou `null` si l'information est hors d'atteinte. */
  day(originCode: string, destinationCode: string, date: string): Promise<DaySeats | null> {
    if (!this.enabled) return Promise.resolve(null);
    const key = `${originCode}|${destinationCode}|${date}`;
    let hit = this.cache.get(key);
    if (!hit) {
      hit = this.fetchDay(originCode, destinationCode, date);
      this.cache.set(key, hit);
    }
    return hit;
  }

  private async fetchDay(
    originCode: string,
    destinationCode: string,
    date: string,
  ): Promise<DaySeats | null> {
    try {
      const res = await this.fetchFn(this.buildUrl(originCode, destinationCode, date));
      if (!res.ok) throw new Error(`relais places libres ${res.status}`);
      const body = (await res.json()) as FreePlacesResponse;
      this.failures = 0;
      return summarizeDay(date, body.proposals ?? [], body.ratio ?? 0);
    } catch {
      this.failures += 1;
      if (this.failures >= MAX_CONSECUTIVE_FAILURES) this.broken = true;
      return null;
    }
  }

  /**
   * Places restantes sur plusieurs dates. Les dates sont traitées par petits
   * paquets ; celles qui échouent sont simplement absentes du résultat.
   */
  async range(originCode: string, destinationCode: string, dates: string[]): Promise<SeatsByDate> {
    const out: SeatsByDate = {};
    if (!this.enabled) return out;
    const queue = [...dates];
    const worker = async (): Promise<void> => {
      for (let date = queue.shift(); date !== undefined; date = queue.shift()) {
        const day = await this.day(originCode, destinationCode, date);
        if (day) out[date] = day;
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return out;
  }

  /**
   * Reporte les places sur une liste de trains, en les appariant par numéro.
   * Le dataset ouvert et le MAX Planner ne recensent pas exactement les mêmes
   * circulations : un train sans correspondance garde `seats` à `undefined`,
   * ce qui se lit « inconnu » et non « complet ».
   */
  static attach(trains: Train[], day: DaySeats | null): Train[] {
    if (!day) return trains;
    return trains.map((t) => {
      const seats = day.byTrain[t.trainNo];
      return seats === undefined ? t : { ...t, seats };
    });
  }
}
