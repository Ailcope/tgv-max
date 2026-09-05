import { describe, expect, it } from "vitest";
import { SncfApiClient } from "@/data/SncfApiClient";

const BASE = "https://ex/datasets/tgvmax";
const ok = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

describe("SncfApiClient.buildUrl", () => {
  it("encodes query params and targets /records", () => {
    const client = new SncfApiClient(async () => ok({}), BASE);
    const url = new URL(
      client.buildUrl('origine="PARIS (intramuros)"', {
        select: "date",
        orderBy: "date",
        limit: 50,
      }),
    );
    expect(url.pathname.endsWith("/records")).toBe(true);
    expect(url.searchParams.get("where")).toBe('origine="PARIS (intramuros)"');
    expect(url.searchParams.get("select")).toBe("date");
    expect(url.searchParams.get("order_by")).toBe("date");
    expect(url.searchParams.get("limit")).toBe("50");
  });

  it("defaults limit to 100 and omits absent options", () => {
    const client = new SncfApiClient(async () => ok({}), BASE);
    const url = new URL(client.buildUrl("x=1"));
    expect(url.searchParams.get("limit")).toBe("100");
    expect(url.searchParams.has("group_by")).toBe(false);
    expect(url.searchParams.has("offset")).toBe(false);
  });
});

/**
 * Un jeu de `total` lignes numérotées, servi cent par cent selon l'offset
 * demandé. Les réponses arrivent dans un ordre quelconque : c'est justement ce
 * qu'on veut éprouver.
 */
function pagedClient(total: number, calls: string[] = []): SncfApiClient {
  return new SncfApiClient(async (input) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 100);
    const results = Array.from(
      { length: Math.max(0, Math.min(limit, total - offset)) },
      (_, i) => offset + i,
    );
    return ok({ total_count: total, results });
  }, BASE);
}

describe("SncfApiClient.all", () => {
  it("paginates until a short page and forwards offsets", async () => {
    const calls: string[] = [];
    const rows = await pagedClient(130, calls).all<number>("x=1");
    expect(rows).toHaveLength(130);
    expect(calls).toHaveLength(2);
    expect(new URL(calls[0]).searchParams.get("offset")).toBeNull();
    expect(new URL(calls[1]).searchParams.get("offset")).toBe("100");
  });

  it("s'arrête à la première page quand elle est incomplète", async () => {
    const calls: string[] = [];
    const rows = await pagedClient(42, calls).all<number>("x=1");
    expect(rows).toHaveLength(42);
    expect(calls).toHaveLength(1);
  });

  it("rend une journée entière dans l'ordre, malgré les pages menées de front", async () => {
    // 5 812 lignes : l'ordre de grandeur d'une journée du jeu de données.
    const rows = await pagedClient(5812).all<number>("x=1", {}, 12000);
    expect(rows).toHaveLength(5812);
    expect(rows[0]).toBe(0);
    expect(rows[5811]).toBe(5811);
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
  });

  it("mène plusieurs pages de front plutôt qu'une par une", async () => {
    let live = 0;
    let peak = 0;
    const client = new SncfApiClient(async (input) => {
      live += 1;
      peak = Math.max(peak, live);
      await Promise.resolve();
      live -= 1;
      const offset = Number(new URL(String(input)).searchParams.get("offset") ?? 0);
      return ok({
        total_count: 1000,
        results: Array.from({ length: 100 }, (_, i) => offset + i),
      });
    }, BASE);
    await client.all<number>("x=1");
    expect(peak).toBeGreaterThan(1);
  });

  it("respecte le plafond sans demander de page au-delà", async () => {
    const calls: string[] = [];
    const rows = await pagedClient(5000, calls).all<number>("x=1", {}, 250);
    expect(rows).toHaveLength(250);
    expect(calls).toHaveLength(3);
  });
});

describe("SncfApiClient error handling", () => {
  it("throws with the HTTP status", async () => {
    const client = new SncfApiClient(
      async () => ({ ok: false, status: 500 }) as unknown as Response,
      BASE,
    );
    await expect(client.records("x=1")).rejects.toThrow("SNCF API 500");
  });
});
