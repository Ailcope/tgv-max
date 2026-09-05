import { beforeEach, describe, expect, it } from "vitest";
import { MAX_RECENT, pushRecent, recentStations, rememberStation } from "@/lib/recent";

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
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => store });
}

beforeEach(() => useStorage(fakeStorage()));

describe("pushRecent", () => {
  it("met la gare en tête", () => {
    expect(pushRecent(["LYON", "LILLE"], "NANTES")).toEqual(["NANTES", "LYON", "LILLE"]);
  });

  it("remonte une gare déjà présente sans la dupliquer", () => {
    expect(pushRecent(["LYON", "LILLE"], "LILLE")).toEqual(["LILLE", "LYON"]);
  });

  it("écarte la plus ancienne quand la liste déborde", () => {
    const full = Array.from({ length: MAX_RECENT }, (_, i) => `GARE ${i}`);
    const next = pushRecent(full, "NOUVELLE");
    expect(next).toHaveLength(MAX_RECENT);
    expect(next[0]).toBe("NOUVELLE");
    expect(next).not.toContain(`GARE ${MAX_RECENT - 1}`);
  });

  it("ignore un nom vide", () => {
    expect(pushRecent(["LYON"], "")).toEqual(["LYON"]);
  });

  it("ne modifie pas la liste reçue", () => {
    const list = ["LYON"];
    pushRecent(list, "LILLE");
    expect(list).toEqual(["LYON"]);
  });
});

describe("recentStations", () => {
  it("est vide au premier passage", () => {
    expect(recentStations()).toEqual([]);
  });

  it("retient les gares choisies, la dernière d'abord", () => {
    rememberStation("LYON (intramuros)");
    rememberStation("LILLE EUROPE");
    expect(recentStations()).toEqual(["LILLE EUROPE", "LYON (intramuros)"]);
  });

  it("survit à un contenu abîmé", () => {
    useStorage(fakeStorage({ "tgvmax.options.v1": '{"gares.recentes":"pas du json"}' }));
    expect(recentStations()).toEqual([]);
  });

  it("écarte ce qui n'est pas un nom de gare", () => {
    useStorage(fakeStorage({ "tgvmax.options.v1": '{"gares.recentes":"[\\"LYON\\",42,null]"}' }));
    expect(recentStations()).toEqual(["LYON"]);
  });

  it("sans stockage, ne retient rien et ne lève pas", () => {
    useStorage(undefined);
    rememberStation("LYON");
    expect(recentStations()).toEqual([]);
  });
});
