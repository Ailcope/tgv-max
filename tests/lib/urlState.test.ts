import { describe, expect, it } from "vitest";
import { buildHash, parseHash, sameHash } from "@/lib/urlState";

describe("parseHash", () => {
  it("lit un onglet seul", () => {
    expect(parseHash("#calendar")).toEqual({ id: "calendar", params: {} });
  });

  it("lit un onglet et sa recherche", () => {
    expect(parseHash("#calendar?from=A&to=B")).toEqual({
      id: "calendar",
      params: { from: "A", to: "B" },
    });
  });

  it("accepte une ancre sans dièse", () => {
    expect(parseHash("map?mode=to").id).toBe("map");
  });

  it("décode les gares telles qu'elles sortent du jeu de données", () => {
    const { params } = parseHash("#calendar?from=PARIS+%28intramuros%29&to=BESAN%C3%87ON+VIOTTE");
    expect(params.from).toBe("PARIS (intramuros)");
    expect(params.to).toBe("BESANÇON VIOTTE");
  });

  it("rend une ancre vide plutôt que de lever sur une adresse nue", () => {
    expect(parseHash("")).toEqual({ id: "", params: {} });
  });
});

describe("buildHash", () => {
  it("écrit l'onglet seul quand il n'y a rien à dire de plus", () => {
    expect(buildHash("map")).toBe("#map");
    expect(buildHash("map", { station: "" })).toBe("#map");
  });

  it("écarte les valeurs vides mais garde les autres", () => {
    expect(buildHash("map", { mode: "to", station: "", scope: "range" })).toBe(
      "#map?mode=to&scope=range",
    );
  });

  it("fait l'aller-retour sans abîmer une gare à parenthèses", () => {
    const hash = buildHash("calendar", { from: "PARIS (intramuros)", to: "LYON (intramuros)" });
    expect(parseHash(hash).params).toEqual({
      from: "PARIS (intramuros)",
      to: "LYON (intramuros)",
    });
  });
});

describe("sameHash", () => {
  it("ignore l'ordre des paramètres", () => {
    expect(sameHash("#calendar?from=A&to=B", "#calendar?to=B&from=A")).toBe(true);
  });

  it("distingue deux onglets", () => {
    expect(sameHash("#calendar?from=A", "#map?from=A")).toBe(false);
  });

  it("distingue un paramètre en plus", () => {
    expect(sameHash("#calendar?from=A", "#calendar?from=A&to=B")).toBe(false);
  });

  it("distingue une valeur différente", () => {
    expect(sameHash("#calendar?from=A", "#calendar?from=B")).toBe(false);
  });

  it("considère l'ancre vide et l'onglet nu comme équivalents à eux-mêmes", () => {
    expect(sameHash("#map", "#map")).toBe(true);
  });
});
