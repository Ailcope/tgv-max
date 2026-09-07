/**
 * Pure translation from Navitia's journey payload to the app's domain types.
 * Kept in the data layer (it knows the vendor's shapes) but free of I/O, so the
 * mode/price/MAX-matching rules are unit-testable against fixtures.
 */
import { maxLegCount, payableCents, unpricedLegCount } from "@/domain/regional";
import type { LegCategory, MixedJourney, MixedLeg } from "@/domain/models";
import { parseCompact } from "@/lib/dates";
import { costToCents } from "@/lib/money";
import { normalize } from "@/lib/text";
import type {
  NavitiaDisplayInformations,
  NavitiaJourney,
  NavitiaPlace,
  NavitiaSection,
  NavitiaTicket,
} from "./navitiaDto";

/** Long-distance trains: the ones a MAX seat can cover. */
const TGV_RE = /longdistance|grande vitesse|tgv|ouigo|intercit|lyria|eurostar|thalys/i;
/** Regional and suburban trains — what the budget is actually spent on. */
const TER_RE =
  /localtrain|express r[ée]gional|\bter\b|rapidtransit|suburban|transilien|\brer\b|train|autocar|coach|bus/i;

/** Which family a leg belongs to, from whichever mode wording Navitia returned. */
export function categorize(info: NavitiaDisplayInformations | undefined): LegCategory {
  const text = `${info?.physical_mode ?? ""} ${info?.commercial_mode ?? ""}`;
  if (TGV_RE.test(text)) return "tgv";
  if (TER_RE.test(text)) return "ter";
  return "other";
}

/** Best available name for one end of a section. */
export function placeName(place: NavitiaPlace | undefined): string {
  return (
    place?.stop_point?.stop_area?.name ??
    place?.stop_area?.name ??
    place?.stop_point?.name ??
    place?.name ??
    "—"
  );
}

/** The train number Navitia advertises, when it advertises one. */
function trainNumber(info: NavitiaDisplayInformations | undefined): string | null {
  const raw = (info?.trip_short_name ?? info?.headsign ?? "").trim();
  return raw || null;
}

/**
 * Section id → fare in cents.
 *
 * A ticket can cover several sections at once (a through fare). It is split
 * evenly across them so per-leg prices stay readable, with the rounding
 * remainder given to the first section: the legs always add back up to the
 * ticket, which is what the budget filter compares against.
 */
export function ticketIndex(tickets: readonly NavitiaTicket[] | undefined): Map<string, number> {
  const prices = new Map<string, number>();
  for (const ticket of tickets ?? []) {
    if (ticket.found === false) continue;
    const cents = costToCents(ticket.cost?.value, ticket.cost?.currency);
    if (cents == null) continue;
    const ids = (ticket.links ?? [])
      .filter((l) => l.type === "section" && l.id)
      .map((l) => l.id as string);
    if (!ids.length) continue;
    const share = Math.floor(cents / ids.length);
    ids.forEach((id, i) => {
      const part = share + (i === 0 ? cents - share * ids.length : 0);
      prices.set(id, (prices.get(id) ?? 0) + part);
    });
  }
  return prices;
}

/** A public-transport section becomes a leg; anything else is walking or waiting. */
const isTrainSection = (s: NavitiaSection): boolean => s.type === "public_transport";

function toLeg(
  section: NavitiaSection,
  prices: ReadonlyMap<string, number>,
  maxTrainNos: ReadonlySet<string>,
): MixedLeg | null {
  const from = section.departure_date_time;
  const to = section.arrival_date_time;
  if (!from || !to) return null;

  const info = section.display_informations;
  const category = categorize(info);
  const trainNo = trainNumber(info);
  // Only a long-distance train can carry a MAX seat, and only if that exact
  // train number shows up in the day's tgvmax export with a seat left.
  const maxSeat = category === "tgv" && trainNo != null && maxTrainNos.has(normalize(trainNo));

  return {
    category,
    mode: info?.commercial_mode ?? info?.physical_mode ?? "Train",
    trainNo,
    origin: placeName(section.from),
    destination: placeName(section.to),
    departure: parseCompact(from).time,
    arrival: parseCompact(to).time,
    minutes: Math.round((section.duration ?? 0) / 60),
    priceCents: section.id ? (prices.get(section.id) ?? null) : null,
    maxSeat,
  };
}

/**
 * One Navitia journey → one {@link MixedJourney}, or `null` when it contains no
 * train at all (a pure walking "journey", which Navitia does return).
 *
 * @param maxTrainNos normalized train numbers with a free MAX seat that day.
 */
export function toMixedJourney(
  journey: NavitiaJourney,
  id: string,
  prices: ReadonlyMap<string, number>,
  maxTrainNos: ReadonlySet<string>,
): MixedJourney | null {
  const sections = journey.sections ?? [];
  const legs = sections
    .filter(isTrainSection)
    .map((s) => toLeg(s, prices, maxTrainNos))
    .filter((l): l is MixedLeg => l !== null);
  if (!legs.length) return null;

  const start = journey.departure_date_time;
  const end = journey.arrival_date_time;
  if (!start || !end) return null;
  const from = parseCompact(start);
  const to = parseCompact(end);

  const walkMinutes = sections
    .filter((s) => !isTrainSection(s))
    .reduce((n, s) => n + Math.round((s.duration ?? 0) / 60), 0);

  return {
    id,
    date: from.date,
    departure: from.time,
    arrival: to.time,
    arrivesNextDay: to.date > from.date,
    totalMinutes: Math.round((journey.duration ?? 0) / 60),
    legs,
    transfers: Math.max(0, legs.length - 1),
    walkMinutes,
    paidCents: payableCents(legs),
    unpricedLegs: unpricedLegCount(legs),
    maxLegs: maxLegCount(legs),
  };
}
