import { SNCF_CONNECT_SEARCH } from "@/config";
import { parseISO } from "@/lib/dates";

/**
 * Lien de réservation vers SNCF Connect.
 *
 * Le site n'expose pas de paramètres structurés : sa barre de recherche prend
 * une phrase, et c'est cette phrase qui voyage dans l'URL sous `userInput`.
 * On la reconstruit donc à l'identique de ce que le site produit lui-même
 * quand on tape une recherche à la main.
 *
 * Vérifié en ouvrant les liens : avec la date, on arrive directement sur la
 * liste des trains ; sans elle, le site retombe sur son écran de saisie des
 * gares. La date n'est donc pas un confort, c'est ce qui fait la différence
 * entre un lien utile et la page d'accueil, d'où son caractère obligatoire.
 *
 * Cela reste un lien de confort, pas un contrat : si le format change, le
 * visiteur atterrit sur la recherche vide, exactement comme avant.
 */

/**
 * Libellé de gare tel que la barre de recherche l'attend. Le dataset ouvert
 * écrit « PARIS (intramuros) », une notation qui n'existe que chez lui : la
 * parenthèse est retirée et le nom repasse en casse normale.
 */
export function bookingStation(name: string): string {
  const bare = name
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // La limite de mot `\b` de JavaScript est ASCII : sur « besançon » elle voit
  // une frontière autour du « ç » et rend « BesanÇOn ». On découpe donc sur les
  // séparateurs réels plutôt que sur `\b`.
  return bare
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{Ll})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());
}

/** `"2026-09-12"` → `"12/09/2026"`, la forme que le site accepte sans ambiguïté. */
function slashDate(isoDate: string): string {
  const d = parseISO(isoDate);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** URL de recherche pré-remplie pour un aller simple, à une date donnée. */
export function bookingUrl(from: string, to: string, date: string): string {
  const phrase = [
    `${bookingStation(from)} - ${bookingStation(to)} le ${slashDate(date)}`,
    "aller-simple",
    "1 voyageur",
  ].join(", ");
  return `${SNCF_CONNECT_SEARCH}?userInput=${encodeURIComponent(phrase)}`;
}
