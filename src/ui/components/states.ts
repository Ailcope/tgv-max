import { clear, el } from "../dom";

/** Loading spinner + message. */
export function loading(node: HTMLElement, message = "Interrogation des données SNCF…"): void {
  clear(node).appendChild(
    el("div", { class: "state" }, [el("div", { class: "spinner" }), el("p", { text: message })]),
  );
}

/**
 * Attente prenant la forme du résultat attendu.
 *
 * Un rond qui tourne au milieu d'une zone vide fait sauter la page au moment où
 * les résultats arrivent : la hauteur change d'un coup, et ce qu'on lisait
 * dessous se déplace. Des lignes fantômes à la bonne taille tiennent la place,
 * et disent au passage la forme de ce qui arrive.
 *
 * `count` est un ordre de grandeur, pas une promesse : c'est le remplissage
 * réel qui décidera de la hauteur définitive.
 */
export function skeleton(
  node: HTMLElement,
  kind: "rows" | "cards" | "calendar" = "rows",
  count = 6,
): void {
  const box = clear(node);
  if (kind === "calendar") {
    box.appendChild(
      el(
        "div",
        { class: "sk-cal", "aria-hidden": "true" },
        Array.from({ length: 42 }, () => el("div", { class: "sk sk-cell" })),
      ),
    );
  } else {
    box.appendChild(
      el(
        "div",
        { class: `sk-list sk-${kind}`, "aria-hidden": "true" },
        Array.from({ length: count }, () => el("div", { class: `sk sk-${kind.slice(0, -1)}` })),
      ),
    );
  }
  // Le fantôme est décoratif ; ce qui doit être annoncé, c'est l'attente.
  box.appendChild(el("p", { class: "sk-say", role: "status", text: "Recherche en cours…" }));
}

/** Ce qu'on propose de faire quand il n'y a rien à montrer. */
export interface EmptyAction {
  label: string;
  onClick: () => void;
}

/**
 * Absence de résultat, avec sa raison.
 *
 * « Aucune place MAX trouvée » ne dit pas si la recherche a échoué, si le jour
 * demandé sort de la fenêtre publiée, ou s'il n'y a réellement rien. La raison
 * et la sortie de secours comptent donc autant que le constat.
 */
export function empty(
  node: HTMLElement,
  message = "Aucune place MAX trouvée.",
  why?: string,
  action?: EmptyAction,
): void {
  const box = el("div", { class: "state state-empty" }, [
    el("div", { class: "state-emoji", text: "🚫" }),
    el("p", { text: message }),
  ]);
  if (why) box.appendChild(el("p", { class: "state-why", text: why }));
  if (action) {
    box.appendChild(el("button", { class: "chip", text: action.label, onclick: action.onClick }));
  }
  clear(node).appendChild(box);
}

/** Error placeholder. */
export function errorState(node: HTMLElement, message = "Erreur lors de la requête."): void {
  clear(node).appendChild(
    el("div", { class: "state state-err" }, [
      el("div", { class: "state-emoji", text: "⚠️" }),
      el("p", { text: message }),
    ]),
  );
}

/** Small muted hint line. */
export const hint = (text: string): HTMLElement => el("p", { class: "hint", text });

/**
 * Ce que couvre le jeu de données, rappelé là où son absence se lit comme un
 * bug : une fenêtre d'environ trente jours, exportée une fois par jour.
 */
export const DATASET_WINDOW =
  "Le jeu de données SNCF couvre environ 30 jours à partir d'aujourd'hui, " +
  "et n'est publié qu'une fois par jour : au-delà, les places ne sont pas encore ouvertes.";
