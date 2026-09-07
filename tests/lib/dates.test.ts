import { describe, expect, it } from "vitest";
import {
  addDays,
  compact,
  dateOnly,
  frDate,
  iso,
  isWeekend,
  nextSaturday,
  parseCompact,
  parseISO,
} from "@/lib/dates";

describe("dates", () => {
  it("formats and parses ISO dates in local time", () => {
    expect(iso(new Date(2026, 6, 4))).toBe("2026-07-04");
    const d = parseISO("2026-07-04T00:00:00+00:00");
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 6, 4]);
    expect(dateOnly("2026-07-04T09:12:00Z")).toBe("2026-07-04");
  });

  it("adds days across month boundaries", () => {
    expect(iso(addDays(new Date(2026, 6, 30), 3))).toBe("2026-08-02");
    expect(iso(addDays(new Date(2026, 6, 4), -1))).toBe("2026-07-03");
  });

  it("renders French short dates", () => {
    expect(frDate("2026-07-04")).toBe("sam. 4 juil.");
  });

  it("finds the upcoming Saturday", () => {
    expect(iso(nextSaturday(new Date(2026, 6, 1)))).toBe("2026-07-04"); // Wed → Sat
    expect(iso(nextSaturday(new Date(2026, 6, 4)))).toBe("2026-07-04"); // Sat → same day
  });

  it("detects weekends", () => {
    expect(isWeekend("2026-07-04")).toBe(true); // Saturday
    expect(isWeekend("2026-07-05")).toBe(true); // Sunday
    expect(isWeekend("2026-07-06")).toBe(false); // Monday
  });
});

describe("compact date-times (Navitia)", () => {
  it("parses the compact form into a date and a time", () => {
    expect(parseCompact("20260908T071500")).toEqual({ date: "2026-09-08", time: "07:15" });
  });

  it("builds the compact form back", () => {
    expect(compact("2026-09-08", "07:15")).toBe("20260908T071500");
  });

  it("round-trips", () => {
    const { date, time } = parseCompact("20261231T235900");
    expect(compact(date, time)).toBe("20261231T235900");
  });
});
