import { pref, setPref } from "@/lib/prefs";
import { select } from "../dom";

/**
 * Un menu déroulant qui se souvient du choix précédent.
 *
 * Les vues déclaraient jusqu'ici leur menu, puis lui réassignaient sa valeur
 * par défaut sur la ligne suivante (`this.staySelect.value = "240"`). La
 * valeur par défaut devient ici un argument, à côté des choix qu'elle est
 * censée désigner, et le choix du visiteur est retenu au passage.
 *
 * `name` sert de clé de stockage : elle doit rester stable dans le temps, et
 * dire à quel écran elle appartient (`"allerRetour.surPlace"`).
 */
export function rememberedSelect(
  name: string,
  options: [value: string, label: string][],
  fallback: string,
  onChange: () => void,
): HTMLSelectElement {
  const sel = select(options, () => {
    setPref(name, sel.value);
    onChange();
  });
  sel.value = pref(
    name,
    fallback,
    options.map(([value]) => value),
  );
  return sel;
}
