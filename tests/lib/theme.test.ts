import { beforeEach, describe, expect, it } from "vitest";
import { applyTheme, nextTheme, themeChoice, toggleTheme, type ThemeChoice } from "@/lib/theme";

/** Un stockage local minimal, suffisant pour ce que le module en attend. */
function fakeStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

function useStorage(store: Storage | undefined): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: () => store,
  });
}

/** Une racine de page réduite à ce dont `applyTheme` se sert. */
function fakeRoot(): HTMLElement {
  const attrs = new Map<string, string>();
  return {
    setAttribute: (k: string, v: string) => void attrs.set(k, v),
    removeAttribute: (k: string) => void attrs.delete(k),
    getAttribute: (k: string) => attrs.get(k) ?? null,
  } as unknown as HTMLElement;
}

beforeEach(() => useStorage(fakeStorage()));

describe("nextTheme", () => {
  it("boucle sur auto, clair, sombre", () => {
    expect(nextTheme("auto")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("auto");
  });
});

describe("applyTheme", () => {
  it("pose l'attribut pour un choix explicite", () => {
    const root = fakeRoot();
    applyTheme("dark", root);
    expect(root.getAttribute("data-theme")).toBe("dark");
  });

  it("retire l'attribut en mode auto, pour repasser sous le réglage du système", () => {
    const root = fakeRoot();
    applyTheme("light", root);
    applyTheme("auto", root);
    expect(root.getAttribute("data-theme")).toBeNull();
  });
});

describe("themeChoice", () => {
  it("vaut auto tant que rien n'a été choisi", () => {
    expect(themeChoice()).toBe("auto");
  });

  it("retient le choix d'une visite à l'autre", () => {
    const root = fakeRoot();
    toggleTheme(root);
    expect(themeChoice()).toBe("light");
    toggleTheme(root);
    expect(themeChoice()).toBe("dark");
    expect(root.getAttribute("data-theme")).toBe("dark");
  });

  it("ignore une valeur devenue inconnue", () => {
    useStorage(fakeStorage({ "tgvmax.options.v1": '{"affichage.theme":"sepia"}' }));
    expect(themeChoice()).toBe("auto");
  });

  it("sans stockage, la bascule s'applique quand même à la page", () => {
    useStorage(undefined);
    const root = fakeRoot();
    const choice: ThemeChoice = toggleTheme(root);
    expect(choice).toBe("light");
    expect(root.getAttribute("data-theme")).toBe("light");
  });
});
