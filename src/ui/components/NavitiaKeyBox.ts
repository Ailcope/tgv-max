import { NAVITIA_SIGNUP_URL } from "@/config";
import type { NavitiaKeyStore } from "@/data/NavitiaKeyStore";
import { button, clear, el } from "../dom";

/**
 * Token panel for the regional mode. Unlike the tgvmax dataset, the SNCF
 * journey API needs a (free) developer key, so the user pastes theirs here —
 * it stays in `localStorage`, and is only ever sent to the SNCF API.
 */
export class NavitiaKeyBox {
  readonly element = el("div", { class: "keybox" });

  constructor(
    private readonly store: NavitiaKeyStore,
    /** Called after the token changed, so the view can retry its search. */
    private readonly onChange: () => void,
  ) {
    this.render();
  }

  /** True when a token is available (from the build or from the user). */
  get hasKey(): boolean {
    return this.store.get() !== null;
  }

  /** Re-read the store and redraw (after an auth error, for instance). */
  render(): void {
    clear(this.element);
    this.element.appendChild(this.hasKey ? this.configured() : this.prompt());
  }

  private configured(): HTMLElement {
    const source = this.store.isBuiltIn ? "fournie par le site" : "enregistrée dans ce navigateur";
    return el("div", { class: "keybox-ok" }, [
      el("span", { text: `🔑 Clé API SNCF ${source}.` }),
      this.store.isBuiltIn
        ? null
        : button("Changer", "keybox-link", () => {
            this.store.clear();
            this.render();
          }),
    ]);
  }

  private prompt(): HTMLElement {
    const input = el("input", {
      class: "date-input keybox-input",
      type: "password",
      placeholder: "Collez votre token SNCF ici",
      autocomplete: "off",
      spellcheck: "false",
    });
    const save = (): void => {
      if (!input.value.trim()) return;
      this.store.set(input.value);
      this.render();
      this.onChange();
    };
    input.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") save();
    });

    return el("div", { class: "keybox-form" }, [
      el("p", {
        class: "keybox-why",
        html:
          "Les trains régionaux passent par l'<b>API SNCF (Navitia)</b>, qui demande un token " +
          "gratuit — contrairement au jeu de données TGV MAX, ouvert. " +
          `<a href="${NAVITIA_SIGNUP_URL}" target="_blank" rel="noopener">Obtenir un token ↗</a>`,
      }),
      el("div", { class: "keybox-row" }, [input, button("Enregistrer", "btn-primary", save)]),
      el("p", {
        class: "hint",
        text: "Le token reste dans votre navigateur ; il n'est envoyé qu'à l'API SNCF.",
      }),
    ]);
  }
}
