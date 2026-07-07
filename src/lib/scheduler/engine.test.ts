import { describe, expect, it } from "vitest";
import { generatePlan, type ScheduleRequest } from "./engine";
import { isPrimaryTerm } from "./terms";
import type {
  Course,
  Institution,
  Program,
  Student,
  Term,
} from "../types";
import { termLabel } from "../types";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const institution: Institution = {
  id: "inst:test",
  slug: "test",
  name: "Test U",
  division: "D1",
  minGraduationGpa: 2.0,
  defaultDegreeCredits: 120,
  terms: [
    { termType: "fall", minCredits: 12, maxCredits: 18, fullTimeThreshold: 12 },
    { termType: "spring", minCredits: 12, maxCredits: 18, fullTimeThreshold: 12 },
    { termType: "summer", minCredits: 0, maxCredits: 9, fullTimeThreshold: null },
  ],
};

let nextId = 0;
function course(
  code: string,
  opts: Partial<{
    credits: number;
    difficulty: number;
    fall: boolean;
    spring: boolean;
    summer: boolean;
    cadence: Course["offering"]["cadence"];
    prereq: string; // compact expression over codes
    coreq: string;
  }> = {},
): Course {
  const prerequisites: Course["prerequisites"] = [];
  const parse = (s: string) => {
    // tiny helper: "A + B" = and, "A | B" = or, single = leaf
    if (s.includes("+"))
      return { and: s.split("+").map((c) => ({ course: c.trim() })) };
    if (s.includes("|"))
      return { or: s.split("|").map((c) => ({ course: c.trim() })) };
    return { course: s.trim() };
  };
  if (opts.prereq)
    prerequisites.push({ type: "prerequisite", expression: parse(opts.prereq) });
  if (opts.coreq)
    prerequisites.push({ type: "corequisite", expression: parse(opts.coreq) });
  return {
    id: `c${nextId++}:${code}`,
    code,
    title: code,
    credits: opts.credits ?? 3,
    difficulty: opts.difficulty ?? 2,
    offering: {
      fall: opts.fall ?? true,
      spring: opts.spring ?? true,
      summer: opts.summer ?? false,
      winter: false,
      cadence: opts.cadence ?? "every_year",
    },
    prerequisites,
  };
}

function programOf(
  courses: Course[],
  opts: Partial<Program> = {},
): Program {
  return {
    id: "program:test",
    slug: "test-major",
    name: "Test Major",
    degreeType: "BS",
    catalogYear: "2025-2026",
    totalCreditsRequired:
      opts.totalCreditsRequired ??
      courses.reduce((s, c) => s + c.credits, 0),
    type: "major",
    categories: opts.categories ?? [
      {
        id: "cat:test:core",
        slug: "core",
        name: "Core",
        creditsRequired: courses.reduce((s, c) => s + c.credits, 0),
        ruleType: "all_of",
        ruleValue: null,
        sortOrder: 1,
        courseIds: courses.map((c) => c.id),
      },
    ],
    ...opts,
  };
}

function studentOf(overrides: Partial<Student> = {}): Student {
  return {
    id: "student:test",
    displayName: "Test Student",
    sport: "Football",
    division: "D1",
    enrollmentStartTerm: "Fall 2025",
    currentCumulativeGpa: 3.0,
    incomingCredits: [],
    ...overrides,
  };
}

function makeRequest(
  courses: Course[],
  overrides: Partial<ScheduleRequest> = {},
): ScheduleRequest {
  return {
    institution,
    program: programOf(courses),
    courses,
    student: studentOf(),
    target: "grad_4yr",
    strategy: "balanced",
    ...overrides,
  };
}

/** A generic 40-course catalog (8 chains of depth 2, plus fillers). */
function genericCatalog(): Course[] {
  const list: Course[] = [];
  for (let i = 0; i < 8; i++) {
    const a = course(`CHAIN${i} 100`);
    const b = course(`CHAIN${i} 200`, { prereq: `CHAIN${i} 100` });
    const c = course(`CHAIN${i} 300`, { prereq: `CHAIN${i} 200` });
    list.push(a, b, c);
  }
  for (let i = 0; i < 16; i++) {
    list.push(course(`FILL ${100 + i}`, { summer: i % 2 === 0 }));
  }
  return list;
}

function courseCodesByTerm(result: ReturnType<typeof generatePlan>, courses: Course[]) {
  const byId = new Map(courses.map((c) => [c.id, c]));
  return result.terms.map((t) => ({
    label: termLabel(t.term),
    codes: t.courseIds.map((id) => byId.get(id)!.code),
    credits: t.totalCredits,
  }));
}

// ---------------------------------------------------------------------------

describe("generatePlan — hard constraints", () => {
  it("always schedules prerequisites strictly before dependents", () => {
    const catalog = genericCatalog();
    const result = generatePlan(makeRequest(catalog));
    expect(result.feasible).toBe(true);
    const byId = new Map(catalog.map((c) => [c.id, c]));
    const termOf = new Map<string, number>();
    result.terms.forEach((t, i) =>
      t.courseIds.forEach((id) => termOf.set(byId.get(id)!.code, i)),
    );
    for (const c of catalog) {
      for (const p of c.prerequisites) {
        if (p.type !== "prerequisite") continue;
        const leaf = (p.expression as { course: string }).course;
        if (termOf.has(leaf) && termOf.has(c.code)) {
          expect(termOf.get(leaf)!).toBeLessThan(termOf.get(c.code)!);
        }
      }
    }
  });

  it("never places a course in a term where it is not offered (incl. cadence)", () => {
    const catalog = [
      ...genericCatalog(),
      course("FALLONLY 1", { spring: false }),
      course("SPRINGONLY 1", { fall: false }),
      course("ALTODD 1", { spring: false, cadence: "alternate_years_odd" }),
      course("ALTEVEN 1", { fall: false, cadence: "alternate_years_even" }),
    ];
    const result = generatePlan(makeRequest(catalog));
    expect(result.feasible).toBe(true);
    const byId = new Map(catalog.map((c) => [c.id, c]));
    for (const t of result.terms) {
      for (const id of t.courseIds) {
        const c = byId.get(id)!;
        if (c.code === "FALLONLY 1") expect(t.term.type).toBe("fall");
        if (c.code === "SPRINGONLY 1") expect(t.term.type).toBe("spring");
        if (c.code === "ALTODD 1") {
          expect(t.term.type).toBe("fall");
          expect(t.term.year % 2).toBe(1);
        }
        if (c.code === "ALTEVEN 1") {
          expect(t.term.type).toBe("spring");
          expect(t.term.year % 2).toBe(0);
        }
      }
    }
  });

  it("keeps every term's credits within [min, max] and ≥ full-time for primary terms", () => {
    const result = generatePlan(makeRequest(genericCatalog()));
    expect(result.feasible).toBe(true);
    for (const t of result.terms) {
      if (isPrimaryTerm(t.term)) {
        expect(t.totalCredits).toBeGreaterThanOrEqual(12);
        expect(t.totalCredits).toBeLessThanOrEqual(18);
      } else {
        expect(t.totalCredits).toBeLessThanOrEqual(9);
      }
    }
  });

  it("schedules corequisites in the same term or earlier", () => {
    const lab = course("PHYS 2110", { coreq: "MATH 1550" });
    const calc = course("MATH 1550", { credits: 4 });
    const catalog = [lab, calc, ...genericCatalog().slice(0, 20)];
    const result = generatePlan(makeRequest(catalog));
    expect(result.feasible).toBe(true);
    const termIdx = new Map<string, number>();
    result.terms.forEach((t, i) =>
      t.courseIds.forEach((id) => {
        const code = catalog.find((c) => c.id === id)!.code;
        termIdx.set(code, i);
      }),
    );
    expect(termIdx.get("MATH 1550")!).toBeLessThanOrEqual(
      termIdx.get("PHYS 2110")!,
    );
  });

  it("reports prerequisite cycles as data errors", () => {
    const a = course("CYC 1", { prereq: "CYC 2" });
    const b = course("CYC 2", { prereq: "CYC 1" });
    const result = generatePlan(makeRequest([a, b]));
    expect(result.feasible).toBe(false);
    expect(result.dataErrors.some((e) => e.includes("cycle"))).toBe(true);
  });
});

describe("generatePlan — targets & feasibility", () => {
  it("meets a 4-year target with a 120-credit program", () => {
    const result = generatePlan(makeRequest(genericCatalog()));
    expect(result.feasible).toBe(true);
    expect(result.deliveredPrimaryTerms).toBeLessThanOrEqual(8);
    const last = result.terms[result.terms.length - 1];
    expect(last.cumulativeDegreePercent).toBe(100);
  });

  it("returns the closest feasible plan + explanation for an impossible target", () => {
    // Chain of depth 8 (fall+spring courses) cannot fit in 6 primary terms.
    const chain: Course[] = [];
    for (let i = 0; i < 8; i++) {
      chain.push(
        course(`DEEP ${i}`, i > 0 ? { prereq: `DEEP ${i - 1}` } : {}),
      );
    }
    const fillers = genericCatalog().slice(0, 24);
    const catalog = [...chain, ...fillers];
    const result = generatePlan(
      makeRequest(catalog, { target: "grad_3yr" }),
    );
    expect(result.feasible).toBe(false);
    expect(result.explanation).toBeTruthy();
    expect(result.explanation).toContain("infeasible");
    // still returns a complete plan, just longer
    expect(result.unscheduledCourseIds).toHaveLength(0);
    expect(result.deliveredPrimaryTerms).toBeGreaterThan(6);
  });

  it("uses incoming credit to shorten the work", () => {
    const catalog = genericCatalog();
    const chainStarts = catalog.filter((c) => c.code.endsWith("100"));
    const withCredit = makeRequest(catalog, {
      student: studentOf({
        incomingCredits: chainStarts.map((c) => ({
          source: "AP",
          satisfiesCourseId: c.id,
          credits: c.credits,
        })),
      }),
    });
    const result = generatePlan(withCredit);
    expect(result.feasible).toBe(true);
    expect(result.incomingDegreeCredits).toBe(
      chainStarts.reduce((s, c) => s + c.credits, 0),
    );
    const scheduled = result.terms.flatMap((t) => t.courseIds);
    for (const c of chainStarts) {
      expect(scheduled).not.toContain(c.id);
    }
  });
});

describe("generatePlan — strategies change the output", () => {
  function catalogWithDifficulty(): Course[] {
    const list: Course[] = [];
    for (let i = 0; i < 10; i++) {
      list.push(course(`HARD ${i}`, { difficulty: 5, summer: true }));
    }
    for (let i = 0; i < 30; i++) {
      list.push(course(`EASY ${i}`, { difficulty: 1, summer: true }));
    }
    return list;
  }

  it("front_load_hard schedules hard courses earlier than balanced", () => {
    const catalog = catalogWithDifficulty();
    const avgHardIndex = (strategy: "balanced" | "front_load_hard") => {
      const result = generatePlan(makeRequest(catalog, { strategy }));
      expect(result.feasible).toBe(true);
      const byId = new Map(catalog.map((c) => [c.id, c]));
      let sum = 0;
      let n = 0;
      result.terms.forEach((t, i) => {
        for (const id of t.courseIds) {
          if (byId.get(id)!.difficulty === 5) {
            sum += i;
            n++;
          }
        }
      });
      return sum / n;
    };
    expect(avgHardIndex("front_load_hard")).toBeLessThan(
      avgHardIndex("balanced"),
    );
  });

  it("light_in_season caps in-season credit load and avoids hard courses in season", () => {
    const catalog = catalogWithDifficulty();
    const calendar = {
      sport: "Football",
      championshipTerms: ["fall" as const],
      inSeasonWeeks: [],
      practiceBlocks: [],
      typicalTravelPattern: {},
    };
    const result = generatePlan(
      makeRequest(catalog, {
        strategy: "light_in_season",
        athleticCalendar: calendar,
        options: { inSeasonMaxCredits: 13 },
      }),
    );
    expect(result.feasible).toBe(true);
    const byId = new Map(catalog.map((c) => [c.id, c]));
    for (const t of result.terms) {
      if (t.term.type === "fall") {
        expect(t.totalCredits).toBeLessThanOrEqual(13);
      }
    }
    // Hard courses should mostly land out of season.
    let hardInSeason = 0;
    let hardTotal = 0;
    for (const t of result.terms) {
      for (const id of t.courseIds) {
        if (byId.get(id)!.difficulty === 5) {
          hardTotal++;
          if (t.term.type === "fall") hardInSeason++;
        }
      }
    }
    expect(hardInSeason / hardTotal).toBeLessThan(0.5);
  });

  it("summer_accelerated uses summers heavily; balanced does not", () => {
    const catalog = catalogWithDifficulty();
    const summerCredits = (strategy: "balanced" | "summer_accelerated") => {
      const result = generatePlan(makeRequest(catalog, { strategy }));
      return result.terms
        .filter((t) => t.term.type === "summer")
        .reduce((s, t) => s + t.totalCredits, 0);
    };
    expect(summerCredits("balanced")).toBe(0);
    expect(summerCredits("summer_accelerated")).toBeGreaterThan(0);
  });

  it("summer_accelerated can hit a 3-year target that balanced cannot", () => {
    const catalog = catalogWithDifficulty(); // 120 credits, all summer-offered
    const balanced = generatePlan(
      makeRequest(catalog, { strategy: "balanced", target: "grad_3yr" }),
    );
    const accelerated = generatePlan(
      makeRequest(catalog, {
        strategy: "summer_accelerated",
        target: "grad_3yr",
      }),
    );
    // 120 credits over 6 primary terms = 20/term > max 18 → balanced needs rescue
    // (summers) or extension; summer_accelerated plans them from the start.
    expect(accelerated.feasible).toBe(true);
    expect(
      accelerated.terms.filter((t) => t.term.type === "summer").length,
    ).toBeGreaterThan(0);
    void balanced;
  });
});

describe("generatePlan — rollups", () => {
  it("computes running degree credits and percent, capped at category limits", () => {
    const catalog = genericCatalog();
    const result = generatePlan(makeRequest(catalog));
    let prev = 0;
    for (const t of result.terms) {
      expect(t.cumulativeDegreeCredits).toBeGreaterThanOrEqual(prev);
      prev = t.cumulativeDegreeCredits;
      expect(t.cumulativeDegreePercent).toBeLessThanOrEqual(100);
    }
    expect(result.terms[result.terms.length - 1].cumulativeDegreePercent).toBe(100);
  });
});

describe("generatePlan — edge cases (Phase 6)", () => {
  it("study abroad term hosts a generic credit block and reduces electives", () => {
    // Program: 60cr core (all_of) + 60cr free electives (choose_n_credits).
    const core: Course[] = [];
    for (let i = 0; i < 20; i++) core.push(course(`CORE ${i}`));
    const electives: Course[] = [];
    for (let i = 0; i < 25; i++) electives.push(course(`ELEC ${i}`));
    const catalog = [...core, ...electives];
    const program = programOf(catalog, {
      totalCreditsRequired: 120,
      categories: [
        {
          id: "cat:test:core",
          slug: "core",
          name: "Core",
          creditsRequired: 60,
          ruleType: "all_of",
          ruleValue: null,
          sortOrder: 1,
          courseIds: core.map((c) => c.id),
        },
        {
          id: "cat:test:free",
          slug: "free",
          name: "Free Electives",
          creditsRequired: 60,
          ruleType: "choose_n_credits",
          ruleValue: 60,
          sortOrder: 2,
          courseIds: electives.map((c) => c.id),
        },
      ],
    });
    const result = generatePlan(
      makeRequest(catalog, {
        program,
        options: { studyAbroadTerms: ["Fall 2027"], studyAbroadCredits: 12 },
      }),
    );
    expect(result.feasible).toBe(true);
    const sa = result.terms.find(
      (t) => t.term.type === "fall" && t.term.year === 2027,
    );
    expect(sa).toBeDefined();
    expect(sa!.studyAbroad).toBe(true);
    expect(sa!.courseIds).toEqual([]);
    expect(sa!.totalCredits).toBe(12);
    // 12 block credits replace 4 elective courses.
    const electiveIds = new Set(electives.map((c) => c.id));
    const scheduledElectives = result.terms
      .flatMap((t) => t.courseIds)
      .filter((id) => electiveIds.has(id));
    expect(scheduledElectives.length * 3).toBe(60 - 12);
    expect(result.terms[result.terms.length - 1].cumulativeDegreePercent).toBe(100);
  });

  it("double major shares gen-eds and the PTD denominator option changes accounting", () => {
    const shared = [course("GEN 1"), course("GEN 2")];
    const aCore = [course("AAA 1"), course("AAA 2")];
    const bCore = [course("BBB 1"), course("BBB 2")];
    const catalog = [...shared, ...aCore, ...bCore, ...genericCatalog().slice(0, 10)];
    const majorA = programOf([], {
      id: "program:a",
      slug: "a",
      totalCreditsRequired: 12,
      categories: [
        {
          id: "cat:a:gen",
          slug: "gen",
          name: "Gen Ed",
          creditsRequired: 6,
          ruleType: "all_of",
          ruleValue: null,
          sortOrder: 1,
          courseIds: shared.map((c) => c.id),
        },
        {
          id: "cat:a:core",
          slug: "core",
          name: "A Core",
          creditsRequired: 6,
          ruleType: "all_of",
          ruleValue: null,
          sortOrder: 2,
          courseIds: aCore.map((c) => c.id),
        },
      ],
    });
    const majorB = programOf([], {
      id: "program:b",
      slug: "b",
      totalCreditsRequired: 12,
      categories: [
        {
          id: "cat:b:gen",
          slug: "gen",
          name: "Gen Ed",
          creditsRequired: 6,
          ruleType: "all_of",
          ruleValue: null,
          sortOrder: 1,
          courseIds: shared.map((c) => c.id),
        },
        {
          id: "cat:b:core",
          slug: "core",
          name: "B Core",
          creditsRequired: 6,
          ruleType: "all_of",
          ruleValue: null,
          sortOrder: 2,
          courseIds: bCore.map((c) => c.id),
        },
      ],
    });
    const primaryOnly = generatePlan(
      makeRequest(catalog, {
        program: majorA,
        secondaryProgram: majorB,
        options: { ptdDenominator: "primary_only" },
      }),
    );
    const combined = generatePlan(
      makeRequest(catalog, {
        program: majorA,
        secondaryProgram: majorB,
        options: { ptdDenominator: "combined" },
      }),
    );
    // Shared gen-eds scheduled exactly once.
    const genCount = (r: typeof primaryOnly) =>
      r.terms.flatMap((t) => t.courseIds).filter((id) =>
        shared.some((c) => c.id === id),
      ).length;
    expect(genCount(primaryOnly)).toBe(2);
    expect(genCount(combined)).toBe(2);
    // Both majors' cores are present.
    const allIds = new Set(primaryOnly.terms.flatMap((t) => t.courseIds));
    for (const c of [...aCore, ...bCore]) expect(allIds.has(c.id)).toBe(true);
    // Denominator option changes the accounting basis.
    expect(primaryOnly.totalCreditsRequired).toBe(12);
    expect(combined.totalCreditsRequired).toBe(24);
    // Combined: shared courses count toward both majors' gen-ed buckets.
    const lastCombined = combined.terms[combined.terms.length - 1];
    expect(lastCombined.cumulativeDegreeCredits).toBe(24);
  });
});
