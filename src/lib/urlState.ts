/**
 * L'état d'une recherche, porté par l'adresse de la page.
 *
 * L'ancre ne retenait que l'onglet ouvert : `#calendar`. Le trajet et la date,
 * eux, ne quittaient jamais la mémoire du navigateur. Envoyer « regarde, il
 * reste de la place ce week-end » revenait donc à envoyer un lien vers la page
 * d'accueil, accompagné des instructions pour refaire la recherche à la main.
 *
 * L'ancre porte maintenant la recherche entière :
 *
 *     #calendar?from=PARIS+%28intramuros%29&to=LYON+%28intramuros%29
 *
 * Le format reste volontairement lisible et tolérant. Un paramètre inconnu est
 * ignoré, un paramètre manquant garde sa valeur par défaut : un vieux lien
 * ouvre au pire la recherche vide, jamais une page en erreur.
 */

/** Ce que porte une ancre : l'onglet, et les paramètres de sa recherche. */
export interface HashState {
  id: string;
  params: Record<string, string>;
}

/** `"#calendar?from=A&to=B"` → `{ id: "calendar", params: { from: "A", to: "B" } }`. */
export function parseHash(hash: string): HashState {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const cut = raw.indexOf("?");
  const id = cut === -1 ? raw : raw.slice(0, cut);
  const params: Record<string, string> = {};
  if (cut !== -1) {
    for (const [key, value] of new URLSearchParams(raw.slice(cut + 1))) params[key] = value;
  }
  return { id, params };
}

/**
 * `("calendar", { from: "A", to: "" })` → `"#calendar?from=A"`.
 *
 * Les valeurs vides sont écartées : un paramètre présent mais vide n'apprend
 * rien et allonge une adresse qu'on va coller dans une conversation.
 */
export function buildHash(id: string, params: Record<string, string> = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const suffix = query.toString();
  return suffix ? `#${id}?${suffix}` : `#${id}`;
}

/** Vrai quand les deux ancres décrivent la même recherche, à l'ordre près. */
export function sameHash(a: string, b: string): boolean {
  const left = parseHash(a);
  const right = parseHash(b);
  if (left.id !== right.id) return false;
  const keys = new Set([...Object.keys(left.params), ...Object.keys(right.params)]);
  for (const key of keys) {
    if (left.params[key] !== right.params[key]) return false;
  }
  return true;
}
