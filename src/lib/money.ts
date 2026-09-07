/** Money helpers. Prices travel through the app in **cents**, to stay exact. */

/** Cents → `"12,50 €"`. */
export function formatEuros(cents: number): string {
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

/** Cents → `"12,50"` (no symbol), for inputs. */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(/\.00$/, "");
}

/** A user-typed amount in euros (`"12,50"` / `"12.5"` / `"20 €"`) → cents; `null` if unusable. */
export function parseEuros(text: string): number | null {
  const clean = text.trim();
  if (clean.startsWith("-")) return null; // un budget négatif n'est pas une saisie à corriger
  const digits = clean.replace(",", ".").replace(/[^\d.]/g, "");
  if (!digits) return null; // `Number("")` vaut 0 : sans ce garde-fou, « abc » passerait pour 0 €
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/**
 * A Navitia cost → cents. Navitia reports `value` as a string, with the
 * currency `"centime"` when the amount is already in cents (the usual case on
 * the SNCF coverage) and a real currency code when it is in units.
 */
export function costToCents(value?: string, currency?: string): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return (currency ?? "").toLowerCase().startsWith("centime") ? Math.round(n) : Math.round(n * 100);
}
