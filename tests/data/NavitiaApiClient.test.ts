import { describe, expect, it } from "vitest";
import { NavitiaApiClient, NavitiaAuthError } from "@/data/NavitiaApiClient";

const BASE = "https://ex/v1";
const res = (status: number, body: unknown): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

const client = (fetchFn: typeof fetch, token: string | null = "tok"): NavitiaApiClient =>
  new NavitiaApiClient(() => token, fetchFn, BASE, "sncf");

const query = { from: "2.3;48.8", to: "4.8;45.7", datetime: "20260908T070000" };

describe("NavitiaApiClient.buildUrl", () => {
  it("targets the coverage's /journeys with a departure datetime", () => {
    const url = new URL(client(async () => res(200, {})).buildUrl(query));
    expect(url.pathname).toBe("/v1/coverage/sncf/journeys");
    expect(url.searchParams.get("from")).toBe("2.3;48.8");
    expect(url.searchParams.get("to")).toBe("4.8;45.7");
    expect(url.searchParams.get("datetime")).toBe("20260908T070000");
    expect(url.searchParams.get("datetime_represents")).toBe("departure");
    expect(url.searchParams.get("count")).toBe("8");
  });

  it("forbids urban modes so the search stays on trains", () => {
    const url = new URL(client(async () => res(200, {})).buildUrl(query));
    const forbidden = url.searchParams.getAll("forbidden_uris[]");
    expect(forbidden).toContain("physical_mode:Metro");
    expect(forbidden).toContain("physical_mode:Bus");
  });

  it("passes the transfer cap and honours an explicit mode list", () => {
    const url = new URL(
      client(async () => res(200, {})).buildUrl({
        ...query,
        maxTransfers: 1,
        count: 3,
        forbiddenModes: ["physical_mode:Ferry"],
      }),
    );
    expect(url.searchParams.get("max_nb_transfers")).toBe("1");
    expect(url.searchParams.get("count")).toBe("3");
    expect(url.searchParams.getAll("forbidden_uris[]")).toEqual(["physical_mode:Ferry"]);
  });
});

describe("NavitiaApiClient.journeys", () => {
  it("sends the token as basic auth, with an empty password", async () => {
    let auth = "";
    await client(async (_input, init) => {
      auth = String((init?.headers as Record<string, string>).Authorization);
      return res(200, { journeys: [] });
    }).journeys(query);
    expect(auth).toBe(`Basic ${btoa("tok:")}`);
  });

  it("refuses to call the API without a token", async () => {
    await expect(client(async () => res(200, {}), null).journeys(query)).rejects.toBeInstanceOf(
      NavitiaAuthError,
    );
  });

  it("maps 401/403 to an auth error the UI can act on", async () => {
    await expect(client(async () => res(401, {})).journeys(query)).rejects.toBeInstanceOf(
      NavitiaAuthError,
    );
    await expect(client(async () => res(403, {})).journeys(query)).rejects.toBeInstanceOf(
      NavitiaAuthError,
    );
  });

  it("treats « no solution » as an empty result, not a failure", async () => {
    const body = await client(async () =>
      res(404, { error: { id: "no_solution", message: "no solution" } }),
    ).journeys(query);
    expect(body.journeys).toEqual([]);
  });

  it("surfaces any other API error message", async () => {
    await expect(
      client(async () =>
        res(404, { error: { id: "unknown_object", message: "Ptref : Filters" } }),
      ).journeys(query),
    ).rejects.toThrow("Ptref : Filters");
  });

  it("falls back to the HTTP status when the body says nothing", async () => {
    await expect(client(async () => res(500, null)).journeys(query)).rejects.toThrow(
      "API SNCF 500",
    );
  });
});

describe("NavitiaApiClient network failures", () => {
  it("replaces the browser's « Failed to fetch » with something actionable", async () => {
    const client = new NavitiaApiClient(
      () => "tok",
      async () => {
        throw new TypeError("Failed to fetch");
      },
      BASE,
    );
    await expect(client.journeys(query)).rejects.toThrow("API SNCF injoignable");
  });
});
