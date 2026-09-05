import { beforeEach, describe, expect, it } from "vitest";
import { isPinned, MAX_PINNED, pinnedTrips, togglePin, togglePinnedTrip } from "@/lib/pinned";

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

const paris = { from: "PARIS (intramuros)", to: "LYON (intramuros)" };
const retour = { from: "LYON (intramuros)", to: "PARIS (intramuros)" };

beforeEach(() => useStorage(fakeStorage()));

describe("togglePin", () => {
  it("épingle un trajet en tête de liste", () => {
    expect(togglePin([retour], paris)).toEqual([paris, retour]);
  });

  it("retire un trajet déjà épinglé", () => {
    expect(togglePin([paris, retour], paris)).toEqual([retour]);
  });

  it("distingue l'aller du retour", () => {
    expect(isPinned([paris], retour)).toBe(false);
  });

  it("écarte le plus ancien quand la liste déborde", () => {
    const full = Array.from({ length: MAX_PINNED }, (_, i) => ({ from: `A${i}`, to: `B${i}` }));
    const next = togglePin(full, paris);
    expect(next).toHaveLength(MAX_PINNED);
    expect(next[0]).toEqual(paris);
  });

  it("ignore un trajet incomplet", () => {
    expect(togglePin([], { from: "PARIS (intramuros)", to: "" })).toEqual([]);
  });

  it("ne modifie pas la liste reçue", () => {
    const list = [retour];
    togglePin(list, paris);
    expect(list).toEqual([retour]);
  });
});

describe("pinnedTrips", () => {
  it("est vide au premier passage", () => {
    expect(pinnedTrips()).toEqual([]);
  });

  it("retient d'une visite à l'autre, et sait retirer", () => {
    togglePinnedTrip(paris);
    expect(pinnedTrips()).toEqual([paris]);
    togglePinnedTrip(paris);
    expect(pinnedTrips()).toEqual([]);
  });

  it("survit à un contenu abîmé", () => {
    useStorage(fakeStorage({ "tgvmax.options.v1": '{"trajets.epingles":"pas du json"}' }));
    expect(pinnedTrips()).toEqual([]);
  });

  it("écarte les entrées qui ne décrivent pas un trajet", () => {
    useStorage(
      fakeStorage({
        "tgvmax.options.v1": '{"trajets.epingles":"[{\\"from\\":\\"A\\",\\"to\\":\\"B\\"},42]"}',
      }),
    );
    expect(pinnedTrips()).toEqual([{ from: "A", to: "B" }]);
  });

  it("sans stockage, ne retient rien et ne lève pas", () => {
    useStorage(undefined);
    expect(togglePinnedTrip(paris)).toEqual([paris]);
    expect(pinnedTrips()).toEqual([]);
  });
});
