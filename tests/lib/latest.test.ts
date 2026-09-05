import { describe, expect, it } from "vitest";
import { Latest } from "@/lib/latest";

describe("Latest", () => {
  it("un tour seul est le dernier", () => {
    const isCurrent = new Latest().begin();
    expect(isCurrent()).toBe(true);
  });

  it("un tour plus récent périme le précédent", () => {
    const latest = new Latest();
    const first = latest.begin();
    const second = latest.begin();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it("annuler périme ce qui est en vol sans ouvrir de tour", () => {
    const latest = new Latest();
    const pending = latest.begin();
    latest.cancel();
    expect(pending()).toBe(false);
  });

  it("le verdict ne change pas d'un appel à l'autre", () => {
    const latest = new Latest();
    const first = latest.begin();
    latest.begin();
    expect(first()).toBe(false);
    expect(first()).toBe(false);
  });

  it("la réponse qui traîne n'écrase pas la plus récente", async () => {
    const latest = new Latest();
    const screen: string[] = [];
    const search = async (label: string, delay: number): Promise<void> => {
      const isCurrent = latest.begin();
      await new Promise((r) => setTimeout(r, delay));
      if (!isCurrent()) return;
      screen.push(label);
    };
    // La lente part d'abord, la rapide ensuite : c'est le cas qui abîme l'écran.
    await Promise.all([search("lente", 20), search("rapide", 1)]);
    expect(screen).toEqual(["rapide"]);
  });
});
