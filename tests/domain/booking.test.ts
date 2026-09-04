import { describe, expect, it } from "vitest";
import { bookingStation, bookingUrl } from "@/domain/booking";

describe("bookingStation", () => {
  it("retire la parenthèse propre au dataset ouvert", () => {
    expect(bookingStation("PARIS (intramuros)")).toBe("Paris");
    expect(bookingStation("LYON (intramuros)")).toBe("Lyon");
  });

  it("remet les noms composés en casse normale", () => {
    expect(bookingStation("BORDEAUX ST JEAN")).toBe("Bordeaux St Jean");
    expect(bookingStation("AIX EN PROVENCE TGV")).toBe("Aix En Provence Tgv");
  });

  it("garde les accents", () => {
    expect(bookingStation("BESANÇON VIOTTE")).toBe("Besançon Viotte");
  });
});

describe("bookingUrl", () => {
  const params = (url: string): string =>
    decodeURIComponent(new URL(url).searchParams.get("userInput") ?? "");

  it("écrit la phrase que la barre de recherche attend", () => {
    expect(params(bookingUrl("PARIS (intramuros)", "LYON (intramuros)", "2026-09-12"))).toBe(
      "Paris - Lyon le 12/09/2026, aller-simple, 1 voyageur",
    );
  });

  it("zéro-remplit le jour et le mois", () => {
    expect(params(bookingUrl("PARIS (intramuros)", "NIMES", "2026-01-05"))).toContain("05/01/2026");
  });

  it("encode la phrase, barres obliques comprises", () => {
    expect(bookingUrl("PARIS (intramuros)", "NIMES", "2026-09-12")).toContain("12%2F09%2F2026");
  });

  it("vise bien SNCF Connect", () => {
    const url = new URL(bookingUrl("PARIS (intramuros)", "NIMES", "2026-09-12"));
    expect(url.hostname).toBe("www.sncf-connect.com");
    expect(url.pathname).toBe("/app/home/search");
  });
});
