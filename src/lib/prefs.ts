/**
 * Les options d'affichage, retenues d'une visite à l'autre.
 *
 * Le site pose une dizaine de menus déroulants : durée de correspondance,
 * temps sur place, heure de retour, tri des destinations. Ce sont des réglages
 * qu'on choisit une fois et qu'on garde, pas des questions à reposer à chaque
 * chargement. Ils repartaient pourtant tous à leur valeur d'usine au moindre
 * rafraîchissement.
 *
 * Rien de sensible ne passe par ici : ni gare, ni date, ni trajet. Uniquement
 * des réglages d'affichage, dans le navigateur du visiteur, et jamais envoyés
 * ailleurs. Ce qu'on cherche vit dans l'URL, pas dans le stockage local.
 */

/** Une seule entrée de stockage, versionnée : la remplacer suffit à tout remettre à zéro. */
const STORE = "tgvmax.options.v1";

type Prefs = Record<string, string>;

/**
 * Le stockage local, ou `null` quand il est hors d'atteinte.
 *
 * En navigation privée, ou cookies bloqués, ce n'est pas la lecture qui
 * échoue : c'est l'accès à la propriété elle-même qui lève. D'où le `try`
 * autour de l'accès, et pas seulement autour du `getItem`.
 */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function read(): Prefs {
  const store = storage();
  if (!store) return {};
  try {
    const raw = store.getItem(STORE);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    // Un contenu abîmé (édité à la main, écrit par une version future) ne doit
    // pas casser la page : on repart d'un objet vide.
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Prefs) : {};
  } catch {
    return {};
  }
}

/**
 * La valeur retenue pour `name`, ou `fallback`.
 *
 * `allowed` est le point important : la liste des choix d'un menu évolue d'une
 * version à l'autre. Sans ce filtre, une valeur devenue inconnue laisserait le
 * menu affiché vide, ce qui se lit comme un bug alors que ce n'est qu'un vieux
 * réglage.
 */
export function pref(name: string, fallback: string, allowed?: readonly string[]): string {
  const value = read()[name];
  if (typeof value !== "string") return fallback;
  if (allowed && !allowed.includes(value)) return fallback;
  return value;
}

/** Retient une option. Sans stockage disponible, l'appel ne fait simplement rien. */
export function setPref(name: string, value: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORE, JSON.stringify({ ...read(), [name]: value }));
  } catch {
    // Quota plein, ou écriture refusée : une option non retenue n'est pas une
    // raison d'interrompre ce que le visiteur était en train de faire.
  }
}
