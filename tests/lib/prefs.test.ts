import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pref, setPref } from "@/lib/prefs";

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

/** Installe un stockage (ou une panne) pour la durée d'un test. */
function useStorage(store: Storage | (() => never) | undefined): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: typeof store === "function" ? store : () => store,
  });
}

const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

beforeEach(() => useStorage(fakeStorage()));

afterEach(() => {
  if (original) Object.defineProperty(globalThis, "localStorage", original);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe("pref", () => {
  it("rend la valeur par défaut quand rien n'a été retenu", () => {
    expect(pref("allerRetour.surPlace", "240")).toBe("240");
  });

  it("rend la valeur retenue", () => {
    setPref("allerRetour.surPlace", "480");
    expect(pref("allerRetour.surPlace", "240")).toBe("480");
  });

  it("garde les options les unes à côté des autres", () => {
    setPref("carte.mode", "to");
    setPref("carte.periode", "date");
    expect(pref("carte.mode", "from")).toBe("to");
    expect(pref("carte.periode", "range")).toBe("date");
  });

  it("écarte une valeur qui n'est plus proposée", () => {
    setPref("ouAller.tri", "prix");
    expect(pref("ouAller.tri", "trains", ["trains", "dur", "abc"])).toBe("trains");
  });

  it("accepte une valeur toujours proposée", () => {
    setPref("ouAller.tri", "abc");
    expect(pref("ouAller.tri", "trains", ["trains", "dur", "abc"])).toBe("abc");
  });

  it("repart de zéro sur un contenu illisible plutôt que de lever", () => {
    useStorage(fakeStorage({ "tgvmax.options.v1": "{ pas du json" }));
    expect(pref("carte.mode", "from")).toBe("from");
  });

  it("repart de zéro quand le contenu n'est pas un objet", () => {
    useStorage(fakeStorage({ "tgvmax.options.v1": '["from"]' }));
    expect(pref("carte.mode", "from")).toBe("from");
  });
});

describe("sans stockage disponible", () => {
  it("rend les valeurs par défaut quand il n'y a pas de stockage", () => {
    useStorage(undefined);
    setPref("carte.mode", "to");
    expect(pref("carte.mode", "from")).toBe("from");
  });

  it("survit à un accès qui lève, comme en navigation privée", () => {
    useStorage(() => {
      throw new Error("SecurityError");
    });
    expect(() => setPref("carte.mode", "to")).not.toThrow();
    expect(pref("carte.mode", "from")).toBe("from");
  });
});
