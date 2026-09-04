import { SNCF_CONNECT_SEARCH } from "@/config";
import { bookingUrl } from "@/domain/booking";
import type { Train } from "@/domain/models";
import { durationMinutes, formatDuration } from "@/domain/time";
import { prettyStation } from "@/lib/text";
import { el } from "../dom";
import { seatsChip } from "./tension";

/** Coloured badge for a network axis (SUD EST, ATLANTIQUE, IC NUIT…). */
export function axisBadge(axis: string): HTMLElement {
  const a = (axis || "").toUpperCase();
  let cls = "axe";
  let label = axis || "—";
  if (a.includes("NUIT")) {
    cls += " axe-nuit";
    label = "🌙 " + label;
  } else if (a.includes("OUIGO")) cls += " axe-ouigo";
  else if (a.includes("ATLANT")) cls += " axe-atl";
  else if (a.includes("SUD")) cls += " axe-se";
  else if (a.includes("NORD")) cls += " axe-nord";
  else if (a.includes("EST")) cls += " axe-est";
  return el("span", { class: cls, text: label });
}

/** `J+1` chip when a train arrives the next calendar day (night trains). */
export function nextDayChip(t: Train): HTMLElement | null {
  return t.arrival < t.departure ? el("span", { class: "t-j1", text: "J+1", title: "Arrivée le lendemain" }) : null;
}

/** One train row: `08:12 → 11:47 · 3h35 · SUD EST · n°6111`. */
export function trainRow(t: Train, showOD = false): HTMLElement {
  const duration = formatDuration(durationMinutes(t.departure, t.arrival));
  const children: (Node | null)[] = [
    el("span", { class: "t-time" }, [
      el("b", { text: t.departure }),
      el("span", { class: "arrow", text: " → " }),
      el("b", { text: t.arrival }),
    ]),
    el("span", { class: "t-dur", text: duration }),
    axisBadge(t.axis),
    nextDayChip(t),
    el("span", { class: "t-no", text: `n°${t.trainNo}` }),
    // Présent seulement quand le relais « places libres » est configuré.
    seatsChip(t.seats),
  ];
  if (showOD) {
    children.unshift(
      el("span", {
        class: "t-od",
        text: `${prettyStation(t.origin)} → ${prettyStation(t.destination)}`,
      }),
    );
  }
  if (!t.hasMaxSeat) children.push(el("span", { class: "t-full", text: "complet MAX" }));
  return el("div", { class: `train${t.hasMaxSeat ? "" : " train-full"}` }, children);
}

/** Lien de réservation vers SNCF Connect, pré-rempli quand on connaît le trajet. */
export const reserveButton = (label = "Réserver ↗", href: string = SNCF_CONNECT_SEARCH): HTMLElement =>
  el("a", {
    class: "btn-reserve",
    href,
    target: "_blank",
    rel: "noopener",
    text: label,
  });

/**
 * Lien de réservation pour une jambe de trajet. Sur une correspondance, chaque
 * train se réserve séparément : un seul bouton global obligerait à ressaisir le
 * second trajet à la main.
 */
export const legReserveLink = (t: Train, date: string): HTMLElement =>
  el("a", {
    class: "leg-reserve",
    href: bookingUrl(t.origin, t.destination, date),
    target: "_blank",
    rel: "noopener",
    text: "Réserver ↗",
    title: `Réserver ${prettyStation(t.origin)} → ${prettyStation(t.destination)} sur SNCF Connect`,
  });
