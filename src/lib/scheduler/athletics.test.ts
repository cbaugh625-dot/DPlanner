import { describe, expect, it } from "vitest";
import { checkAthleticLoad } from "./athletics";
import type { AthleticCalendar, Course, PlannedTerm } from "../types";

const calendar: AthleticCalendar = {
  sport: "Football",
  championshipTerms: ["fall"],
  inSeasonWeeks: [],
  practiceBlocks: [
    { days: ["Mon", "Wed"], start: "06:00", end: "09:00", label: "Practice" },
  ],
  typicalTravelPattern: { description: "Friday travel", daysPerWeekInSeason: 2 },
};

function course(id: string, difficulty: number): Course {
  return {
    id,
    code: id.toUpperCase(),
    title: id,
    credits: 3,
    difficulty,
    offering: {
      fall: true,
      spring: true,
      summer: false,
      winter: false,
      cadence: "every_year",
    },
    prerequisites: [],
  };
}

const courseMap = new Map<string, Course>([
  ["easy1", course("easy1", 1)],
  ["hard1", course("hard1", 5)],
]);

function term(
  type: "fall" | "spring",
  year: number,
  credits: number,
  courseIds: string[] = [],
): PlannedTerm {
  return {
    term: { type, year },
    termIndex: 1,
    courseIds,
    totalCredits: credits,
    cumulativeDegreeCredits: credits,
    cumulativeDegreePercent: 10,
  };
}

describe("checkAthleticLoad", () => {
  it("warns when an in-season term is overloaded", () => {
    const flags = checkAthleticLoad(
      [term("fall", 2025, 16), term("spring", 2026, 16)],
      calendar,
      courseMap,
      { inSeasonMaxCredits: 13 },
    );
    const overload = flags.filter((f) => f.ruleKey === "in_season_overload");
    expect(overload).toHaveLength(1); // only the fall (in-season) term
    expect(overload[0].term).toBe("Fall 2025");
    expect(overload[0].severity).toBe("warning");
    expect(overload[0].message).toContain("Mon/Wed 06:00–09:00");
  });

  it("notes highest-difficulty courses scheduled in season", () => {
    const flags = checkAthleticLoad(
      [term("fall", 2025, 12, ["hard1", "easy1"]), term("spring", 2026, 12, ["hard1"])],
      calendar,
      courseMap,
    );
    const hard = flags.filter((f) => f.ruleKey === "hard_course_in_season");
    expect(hard).toHaveLength(1);
    expect(hard[0].term).toBe("Fall 2025");
    expect(hard[0].message).toContain("HARD1");
  });

  it("returns nothing without a calendar or when in-season load is fine", () => {
    expect(checkAthleticLoad([term("fall", 2025, 18)], null, courseMap)).toEqual([]);
    expect(
      checkAthleticLoad([term("fall", 2025, 12, ["easy1"])], calendar, courseMap),
    ).toEqual([]);
  });
});
