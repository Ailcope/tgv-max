import { KOFI_URL } from "@/config";
import type { StationRepository } from "@/data/StationRepository";
import type { TgvmaxRepository } from "@/data/TgvmaxRepository";
import { frDateTime } from "@/lib/dates";
import { buildHash, parseHash, sameHash } from "@/lib/urlState";
import { CommandPalette } from "@/ui/components/CommandPalette";
import { KofiPanel } from "@/ui/components/KofiPanel";
import { clear, el } from "@/ui/dom";
import type { View } from "@/ui/views/View";

/**
 * Application shell: builds the layout, wires hash-based tab routing, and shows
 * the data-freshness banner. Views are injected — App knows nothing about them
 * beyond the {@link View} contract. The footer and the SEO/FAQ section live as
 * static HTML in `index.html` so search engines index them without JS.
 */
export class App {
  private readonly tabs = new Map<string, HTMLElement>();
  private readonly kofi = new KofiPanel();
  private readonly palette: CommandPalette;

  constructor(
    private readonly root: HTMLElement,
    private readonly views: View[],
    private readonly repo: TgvmaxRepository,
    stations: StationRepository,
  ) {
    this.palette = new CommandPalette(stations, (r) => {
      // Origine + destination → Calendrier ; origine seule → Où partir ?
      this.open(r.destination ? "calendar" : "destinations", r.origin, r.destination);
    });
  }

  /**
   * Ouvre un onglet sur un trajet donné. C'est ce que fait la palette de
   * recherche, et c'est aussi ce dont une vue a besoin pour passer la main à
   * une autre : la carte de chaleur montre où il reste de la place, le
   * calendrier dit quand, et l'une doit pouvoir mener à l'autre.
   */
  open(id: string, origin: string, destination?: string): void {
    this.views.find((v) => v.id === id)?.preset?.(origin, destination);
    this.navigate(id);
  }

  mount(): void {
    const nav = el("nav", { class: "tabs", role: "tablist" });
    const panelsHost = el("main", { class: "wrap" });
    for (const view of this.views) {
      const tab = el(
        "button",
        {
          class: "tab",
          role: "tab",
          title: `${view.label} · ${view.hint}`, // le sous-titre disparaît sur petit écran
          onclick: () => this.navigate(view.id),
        },
        [
          el("span", { class: "tab-emoji", text: view.emoji }),
          el("span", { class: "tab-txt" }, [
            el("b", { text: view.label }),
            el("small", { text: view.hint }),
          ]),
        ],
      );
      this.tabs.set(view.id, tab);
      nav.appendChild(tab);
      view.element.classList.add("panel");
      panelsHost.appendChild(view.element);
      // La vue annonce ses changements ; c'est l'application qui décide ce
      // qu'elle en fait, ici tenir l'adresse de la page à jour.
      view.onStateChange = () => this.publish(view);
    }

    const freshness = el("div", { class: "freshness" });
    clear(this.root).append(
      this.header(nav),
      freshness,
      panelsHost,
      this.kofi.element,
      this.palette.element,
    );

    window.addEventListener("hashchange", () => this.activate(this.currentId()));
    window.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (this.palette.isOpen) this.palette.close();
        else this.palette.open();
      }
    });
    this.activate(this.currentId());
    void this.showFreshness(freshness);
  }

  private currentId(): string {
    const { id } = parseHash(location.hash);
    return this.views.some((v) => v.id === id) ? id : (this.views[0]?.id ?? "");
  }

  private navigate(id: string): void {
    if (parseHash(location.hash).id === id) this.activate(id);
    else location.hash = id; // triggers hashchange → activate
  }

  private activate(id: string): void {
    const { params } = parseHash(location.hash);
    for (const view of this.views) {
      const isActive = view.id === id;
      const tab = this.tabs.get(view.id);
      tab?.classList.toggle("active", isActive);
      tab?.setAttribute("aria-selected", String(isActive));
      view.element.classList.toggle("active", isActive);
      if (!isActive) continue;
      this.reveal(tab);
      // Une adresse qui porte une recherche l'emporte sur ce que la vue
      // affichait : c'est tout l'intérêt d'un lien qu'on reçoit. On ne
      // restaure toutefois que si l'adresse dit autre chose que l'écran, sinon
      // un simple passage d'un onglet à l'autre relancerait la même requête.
      const differs = !sameHash(location.hash, buildHash(view.id, view.state?.() ?? {}));
      if (view.restore && differs && Object.keys(params).length) view.restore(params);
      view.activate();
      // Changer d'onglet réécrit l'ancre sans paramètres : on y remet aussitôt
      // ce que la vue affiche, sinon l'adresse dit « carte » pendant que
      // l'écran montre une recherche précise.
      this.publish(view);
    }
  }

  /**
   * Reporte la recherche d'une vue dans l'adresse de la page.
   *
   * `replaceState` plutôt qu'une écriture sur `location.hash` : la seconde
   * déclenche un `hashchange`, donc une réactivation de la vue qui vient
   * justement de se mettre à jour, et empile une entrée d'historique à chaque
   * frappe. Le bouton « précédent » doit ramener à l'écran précédent, pas
   * défaire un choix de gare caractère par caractère.
   */
  private publish(view: View): void {
    if (!view.state || !view.element.classList.contains("active")) return;
    const next = buildHash(view.id, view.state());
    if (sameHash(location.hash, next)) return;
    history.replaceState(null, "", next);
  }

  /**
   * Ramène l'onglet actif dans la partie visible de la barre.
   *
   * Sur un écran étroit la barre défile horizontalement : sans cela, l'onglet
   * ouvert par un lien reçu ou par la palette peut se trouver hors champ, et
   * la page semble n'avoir rien fait.
   */
  private reveal(tab?: HTMLElement): void {
    tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  private header(nav: HTMLElement): HTMLElement {
    return el("header", { class: "topbar" }, [
      el("div", { class: "brand" }, [
        el("span", { class: "logo", text: "🚄" }),
        el("div", {}, [
          el("h1", { html: 'TGV <span class="max">MAX</span> Planner' }),
          el("p", {
            class: "tagline",
            text: "Vos places MAX, enfin lisibles — sur 30 jours, par destination, sur une carte.",
          }),
        ]),
        el("button", {
          class: "btn-search",
          title: "Recherche rapide (⌘K / Ctrl+K)",
          html: "🔍 <kbd>⌘K</kbd>",
          onclick: () => this.palette.open(),
        }),
        el("button", {
          class: "btn-share",
          title: "Copier le lien de cette recherche",
          text: "🔗 Partager",
          onclick: (e: Event) => void this.share(e.currentTarget as HTMLElement),
        }),
        el("a", {
          class: "btn-kofi",
          href: KOFI_URL, // fallback : clic molette / sans JS → page Ko-fi
          target: "_blank",
          rel: "noopener",
          title: "Soutenir ce projet",
          text: "☕ Soutenir",
          onclick: (e: Event) => {
            e.preventDefault(); // clic normal : panneau intégré, on reste sur le site
            this.kofi.open();
          },
        }),
      ]),
      nav,
    ]);
  }

  /**
   * Copie l'adresse courante, qui porte désormais la recherche affichée.
   *
   * Le presse-papiers peut être refusé (page servie sans HTTPS, permission
   * bloquée) : plutôt qu'un échec muet, le bouton dit alors quoi faire à la
   * main. Dans les deux cas il reprend son intitulé au bout de deux secondes.
   */
  private async share(btn: HTMLElement): Promise<void> {
    const label = btn.textContent ?? "";
    try {
      await navigator.clipboard.writeText(location.href);
      btn.textContent = "✅ Lien copié";
    } catch {
      btn.textContent = "Copiez l'adresse de la page";
    }
    setTimeout(() => {
      btn.textContent = label;
    }, 2200);
  }

  private async showFreshness(box: HTMLElement): Promise<void> {
    const ts = await this.repo.lastUpdate();
    const when = ts
      ? `Données SNCF du <b>${frDateTime(ts)}</b>`
      : "Données mises à jour une fois par jour";
    box.innerHTML = `<span class="fr-ico">⏱️</span><span>${when} · les places MAX partent vite : une dispo « OUI » peut déjà être réservée. À confirmer sur SNCF Connect.</span>`;
  }
}
