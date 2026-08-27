import type { DestinationAvailability, OriginAvailability, Train } from "./models";
import { durationMinutes } from "./time";

/** Heatmap intensity bucket (0 = none … 4 = 10+ trains) for the calendar. */
export type HeatLevel = 0 | 1 | 2 | 3 | 4;

export function heatLevel(n: number): HeatLevel {
  if (n === 0) return 0;
  if (n <= 2) return 1;
  if (n <= 5) return 2;
  if (n <= 9) return 3;
  return 4;
}

interface GroupedAvailability {
  station: string;
  trains: number;
  firstDeparture: string;
  fastestMinutes: number;
  list: Train[];
}

/**
 * Aggregate a flat list of MAX trains (one date) by one end of the trip:
 * count, earliest departure, fastest trip. Sorted by number of trains desc.
 */
function groupBy(trains: Train[], station: (t: Train) => string): GroupedAvailability[] {
  const byStation = new Map<string, GroupedAvailability>();
  for (const t of trains) {
    let g = byStation.get(station(t));
    if (!g) {
      g = {
        station: station(t),
        trains: 0,
        firstDeparture: "99:99",
        fastestMinutes: Infinity,
        list: [],
      };
      byStation.set(g.station, g);
    }
    g.trains += 1;
    if (t.departure < g.firstDeparture) g.firstDeparture = t.departure;
    g.fastestMinutes = Math.min(g.fastestMinutes, durationMinutes(t.departure, t.arrival));
    g.list.push(t);
  }
  return [...byStation.values()].sort((a, b) => b.trains - a.trains);
}

/**
 * Aggregate a flat list of MAX trains (one date, one origin) by destination:
 * count, earliest departure, fastest trip. Sorted by number of trains desc.
 */
export function aggregateByDestination(trains: Train[]): DestinationAvailability[] {
  return groupBy(trains, (t) => t.destination).map(({ station: destination, ...rest }) => ({
    destination,
    ...rest,
  }));
}

/**
 * Aggregate a flat list of MAX trains (one date, one destination) by origin:
 * count, earliest departure, fastest trip. Sorted by number of trains desc.
 */
export function aggregateByOrigin(trains: Train[]): OriginAvailability[] {
  return groupBy(trains, (t) => t.origin).map(({ station: origin, ...rest }) => ({
    origin,
    ...rest,
  }));
}
