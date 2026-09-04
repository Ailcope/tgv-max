import {
  isAlarming,
  tensionMessage,
  tensionOf,
  tensionOfLegs,
  weakestLeg,
  type TensionLevel,
} from "@/domain/tension";
import { el } from "../dom";

/**
 * Le bandeau rouge clignotant quand il ne reste plus grand-chose, et la petite
 * pastille « N places » posée sur un train ou une journée.
 *
 * Le clignotement est volontairement réservé aux deux niveaux les plus tendus :
 * s'il s'allumait pour tout, il ne voudrait plus rien dire. Il est aussi coupé
 * pour qui a demandé à réduire les animations (`prefers-reduced-motion`), le
 * message restant lisible sans lui.
 */

/** Pastille compacte : `12 places`, colorée selon la tension. */
export function seatsChip(seats: number | undefined): HTMLElement | null {
  if (seats === undefined) return null;
  const level = tensionOf(seats);
  return el("span", {
    class: `seats seats-${level}`,
    text: seats > 0 ? `${seats} place${seats > 1 ? "s" : ""}` : "complet",
    title:
      seats > 0
        ? `${seats} place(s) MAX encore réservable(s) d'après le MAX Planner`
        : "Plus de place MAX sur ce train",
  });
}

/**
 * Bandeau d'alerte pour un trajet. `seatsPerLeg` contient une entrée par train
 * emprunté : un direct en a une, une correspondance deux. Rend `null` quand
 * il n'y a rien à signaler (places confortables, ou comptes inconnus).
 */
export function tensionAlert(seatsPerLeg: Array<number | undefined>): HTMLElement | null {
  const level = tensionOfLegs(seatsPerLeg);
  if (!isAlarming(level)) return null;
  const seats = weakestLeg(seatsPerLeg) ?? 0;
  return alertBox(level, tensionMessage(level, seats, seatsPerLeg.length));
}

/** Le bandeau lui-même, isolé pour être réutilisable avec un texte à soi. */
export function alertBox(level: TensionLevel, message: string): HTMLElement {
  return el(
    "div",
    {
      class: `tension tension-${level}`,
      role: "status",
      // Annoncé une fois par les lecteurs d'écran, sans interrompre la lecture.
      "aria-live": "polite",
    },
    [el("span", { class: "tension-ico", text: "⚠️" }), el("span", { text: message })],
  );
}
