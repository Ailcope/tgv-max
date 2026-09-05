/**
 * Thème clair ou sombre.
 *
 * Par défaut le site suit le réglage du système : c'est ce que fait déjà le
 * navigateur pour tout le reste, et c'est le comportement attendu d'une page
 * qu'on ouvre le soir. Reste le cas de celui dont le système dit « sombre »
 * mais qui veut ce site en clair, d'où les trois états plutôt que deux.
 *
 * Le choix vit dans les options retenues (voir `prefs.ts`), donc dans le
 * navigateur du visiteur, jamais dans l'adresse : un lien partagé ne doit pas
 * imposer son thème à celui qui le reçoit.
 */
import { pref, setPref } from "./prefs";

export type ThemeChoice = "auto" | "light" | "dark";

const KEY = "affichage.theme";
const ORDER: ThemeChoice[] = ["auto", "light", "dark"];

/** Intitulé du bouton pour chaque état, l'emoji disant l'état courant. */
export const THEME_LABELS: Record<ThemeChoice, string> = {
  auto: "🌗 Auto",
  light: "☀️ Clair",
  dark: "🌙 Sombre",
};

/** Le choix retenu, `"auto"` tant que le visiteur n'a rien décidé. */
export function themeChoice(): ThemeChoice {
  return pref(KEY, "auto", ORDER) as ThemeChoice;
}

/** L'état suivant dans le cycle auto → clair → sombre → auto. */
export function nextTheme(current: ThemeChoice): ThemeChoice {
  return ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
}

/**
 * Applique un choix à la page.
 *
 * `auto` retire l'attribut plutôt que d'écrire une valeur : la feuille de style
 * repasse alors sous `prefers-color-scheme`, et le site suit le système même
 * s'il change pendant la visite.
 */
export function applyTheme(
  choice: ThemeChoice,
  root: HTMLElement = document.documentElement,
): void {
  if (choice === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

/** Passe à l'état suivant, l'applique, le retient, et le rend. */
export function toggleTheme(root: HTMLElement = document.documentElement): ThemeChoice {
  const choice = nextTheme(themeChoice());
  setPref(KEY, choice);
  applyTheme(choice, root);
  return choice;
}
