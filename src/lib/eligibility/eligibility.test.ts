import { describe, expect, it } from "vitest";
import { checkEligibility, type EligibilityInput } from "./index";
import type { EligibilityRuleset, PlannedTerm, TermType } from "../types";

// ---------------------------------------------------------------------------

const DI_RULES: EligibilityRuleset = {
  id: "rs1",
  division: "D1",
  effectiveDate: "2024-08-01",
  verified: true, // avoid the unverified info flag in most tests
  sourceNote: null,
  rules: {
    min_credits_per_term_for_next_term: 6,
    full_time_min_credits: 12,
    annual_hours_required: 24,
    annual_hours_fall_spring_only: 18,
    year1_hours_by_third_semester: 24,
    ptd_percent_by_year: { "3": 40, "4": 60, "5": 80 },
    declare_major_by_semester: 5,
    degree_applicable_only_from_semester: 5,
    gpa_percent_of_grad_min_by_year: { "2": 90, "3": 95, "4": 100 },
    eligibility_clock_years: 5,
    seasons_of_competition: 4,
  },
};

/**
 * Build a plan from per-term credit tuples. Degree-applicable credits default
 * to all credits (override per-term with `applicable`).
 */
function makeTerms(
  spec: {
    type: TermType;
    year: number;
    credits: number;
    applicable?: number;
  }[],
  incomingDegreeCredits = 0,
): PlannedTerm[] {
  let cum = incomingDegreeCredits;
  return spec.map((s, i) => {
    cum += s.applicable ?? s.credits;
    return {
      term: { type: s.type, year: s.year },
      termIndex: i + 1,
      courseIds: [],
      totalCredits: s.credits,
      cumulativeDegreeCredits: cum,
      cumulativeDegreePercent: Math.min(100, (cum / 120) * 100),
    };
  });
}

/** A fully compliant 4-year plan: 15 credits × 8 semesters = 120. */
function compliantTerms(): PlannedTerm[] {
  const spec = [];
  for (let y = 0; y < 4; y++) {
    spec.push({ type: "fall" as const, year: 2025 + y, credits: 15 });
    spec.push({ type: "spring" as const, year: 2026 + y, credits: 15 });
  }
  return makeTerms(spec);
}

function input(overrides: Partial<EligibilityInput> = {}): EligibilityInput {
  return {
    terms: compliantTerms(),
    student: { currentCumulativeGpa: 3.0 },
    institution: { minGraduationGpa: 2.0 },
    ruleset: DI_RULES,
    totalCreditsRequired: 120,
    incomingCreditHours: 0,
    incomingDegreeCredits: 0,
    ...overrides,
  };
}

const errors = (flags: { severity: string }[]) =>
  flags.filter((f) => f.severity === "error");

// ---------------------------------------------------------------------------

describe("checkEligibility — compliant plan", () => {
  it("produces zero errors for a fully compliant plan", () => {
    const flags = checkEligibility(input());
    expect(errors(flags)).toEqual([]);
  });

  it("flags an unverified ruleset with an info flag", () => {
    const flags = checkEligibility(
      input({ ruleset: { ...DI_RULES, verified: false } }),
    );
    expect(
      flags.some((f) => f.ruleKey === "ruleset_unverified" && f.severity === "info"),
    ).toBe(true);
  });
});

describe("checkEligibility — per-term rules", () => {
  it("flags a term below the 6-hour minimum", () => {
    const terms = compliantTerms();
    terms[3].totalCredits = 5;
    const flags = checkEligibility(input({ terms }));
    const f = flags.find((x) => x.ruleKey === "min_term_hours");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("error");
    expect(f!.term).toBe("Spring 2027");
  });

  it("flags a term below full-time enrollment", () => {
    const terms = compliantTerms();
    terms[2].totalCredits = 9;
    const flags = checkEligibility(input({ terms }));
    const f = flags.find((x) => x.ruleKey === "full_time_enrollment");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("error");
    expect(f!.term).toBe("Fall 2026");
  });
});

describe("checkEligibility — annual rules", () => {
  it("flags a year below 24 total hours", () => {
    // Year 2: fall 11 + spring 11 = 22 (< 24) — also triggers full-time flags.
    const terms = makeTerms([
      { type: "fall", year: 2025, credits: 15 },
      { type: "spring", year: 2026, credits: 15 },
      { type: "fall", year: 2026, credits: 11 },
      { type: "spring", year: 2027, credits: 11 },
      { type: "fall", year: 2027, credits: 15 },
      { type: "spring", year: 2028, credits: 15 },
      { type: "fall", year: 2028, credits: 15 },
      { type: "spring", year: 2029, credits: 15 },
    ]);
    const flags = checkEligibility(input({ terms }));
    const f = flags.find((x) => x.ruleKey === "annual_hours");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("error");
    expect(f!.message).toContain("Year 2");
  });

  it("flags a year where fall+spring hours are under 18 even if summer fills the total", () => {
    const terms = makeTerms([
      { type: "fall", year: 2025, credits: 12 },
      { type: "spring", year: 2026, credits: 5 },
      { type: "summer", year: 2026, credits: 9 }, // total 26 ≥ 24, but F+S=17 < 18
      { type: "fall", year: 2026, credits: 15 },
      { type: "spring", year: 2027, credits: 15 },
      { type: "fall", year: 2027, credits: 15 },
      { type: "spring", year: 2028, credits: 15 },
      { type: "fall", year: 2028, credits: 15 },
      { type: "spring", year: 2029, credits: 15 },
    ]);
    const flags = checkEligibility(input({ terms }));
    const f = flags.find((x) => x.ruleKey === "annual_hours_fall_spring");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("error");
    expect(f!.message).toContain("Year 1");
    expect(flags.some((x) => x.ruleKey === "annual_hours")).toBe(false);
  });
});

describe("checkEligibility — first-year and PTD rules", () => {
  it("flags fewer than 24 hours before the third semester", () => {
    const terms = makeTerms([
      { type: "fall", year: 2025, credits: 12 },
      { type: "spring", year: 2026, credits: 11 }, // 23 before 3rd semester
      { type: "fall", year: 2026, credits: 15 },
      { type: "spring", year: 2027, credits: 15 },
      { type: "fall", year: 2027, credits: 15 },
      { type: "spring", year: 2028, credits: 15 },
      { type: "fall", year: 2028, credits: 15 },
      { type: "spring", year: 2029, credits: 15 },
    ]);
    const flags = checkEligibility(input({ terms }));
    const f = flags.find((x) => x.ruleKey === "year1_24_hours");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("error");
  });

  it("counts summer + incoming credit toward the third-semester rule", () => {
    const terms = makeTerms([
      { type: "fall", year: 2025, credits: 12 },
      { type: "spring", year: 2026, credits: 12 },
      { type: "summer", year: 2026, credits: 6 },
      { type: "fall", year: 2026, credits: 15 },
      { type: "spring", year: 2027, credits: 15 },
      { type: "fall", year: 2027, credits: 15 },
      { type: "spring", year: 2028, credits: 15 },
      { type: "fall", year: 2028, credits: 15 },
      { type: "spring", year: 2029, credits: 15 },
    ]);
    // fall 12 + spring 12 + summer 6 = 30 ≥ 24 → no flag. Note summer sits
    // before the 3rd primary term here.
    const flags = checkEligibility(input({ terms }));
    expect(flags.some((x) => x.ruleKey === "year1_24_hours")).toBe(false);
  });

  it("flags PTD below 40% entering year 3", () => {
    // Only 9 applicable credits/term: after 2 years = 36/120 = 30% < 40%.
    const spec = [];
    for (let y = 0; y < 5; y++) {
      spec.push({
        type: "fall" as const,
        year: 2025 + y,
        credits: 12,
        applicable: 9,
      });
      spec.push({
        type: "spring" as const,
        year: 2026 + y,
        credits: 12,
        applicable: 9,
      });
    }
    const flags = checkEligibility(input({ terms: makeTerms(spec) }));
    const f = flags.find((x) => x.ruleKey === "ptd_40_percent");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("error");
    expect(f!.message).toContain("40%");
  });

  it("passes 40-60-80 checkpoints on a compliant plan", () => {
    const flags = checkEligibility(input());
    expect(flags.some((x) => x.ruleKey.startsWith("ptd_"))).toBe(false);
  });

  it("warns about non-degree-applicable credits from semester 5 onward", () => {
    const spec = [];
    for (let y = 0; y < 4; y++) {
      spec.push({ type: "fall" as const, year: 2025 + y, credits: 15 });
      spec.push({ type: "spring" as const, year: 2026 + y, credits: 15 });
    }
    spec[4].applicable = 12; // fall 2027 = semester 5: 3 non-applicable hours
    const flags = checkEligibility(input({ terms: makeTerms(spec) }));
    const f = flags.find((x) => x.ruleKey === "non_degree_applicable_credits");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("warning");
    expect(f!.term).toBe("Fall 2027");
  });
});

describe("checkEligibility — GPA and clock", () => {
  it("flags a GPA below the year-2 threshold (90% of grad minimum)", () => {
    const flags = checkEligibility(
      input({ student: { currentCumulativeGpa: 1.7 } }), // < 1.80
    );
    const f = flags.find((x) => x.ruleKey.startsWith("gpa_year_"));
    expect(f).toBeDefined();
    expect(f!.severity).toBe("error");
    expect(f!.message).toContain("1.80");
  });

  it("flags GPA 1.95 only at the 100% checkpoint (year 4)", () => {
    const flags = checkEligibility(
      input({ student: { currentCumulativeGpa: 1.95 } }),
    );
    const f = flags.find((x) => x.ruleKey.startsWith("gpa_year_"));
    expect(f).toBeDefined();
    expect(f!.ruleKey).toBe("gpa_year_4");
  });

  it("passes GPA checks with a 3.0", () => {
    const flags = checkEligibility(input());
    expect(flags.some((x) => x.ruleKey.startsWith("gpa_year_"))).toBe(false);
  });

  it("errors when the plan exceeds the 5-year clock", () => {
    const spec = [];
    for (let y = 0; y < 6; y++) {
      spec.push({ type: "fall" as const, year: 2025 + y, credits: 12 });
      spec.push({ type: "spring" as const, year: 2026 + y, credits: 12 });
    }
    const flags = checkEligibility(input({ terms: makeTerms(spec) }));
    const f = flags.find((x) => x.ruleKey === "eligibility_clock");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("error");
  });

  it("warns (not errors) when the plan uses exactly the full clock", () => {
    const spec = [];
    for (let y = 0; y < 5; y++) {
      spec.push({ type: "fall" as const, year: 2025 + y, credits: 12 });
      spec.push({ type: "spring" as const, year: 2026 + y, credits: 12 });
    }
    const flags = checkEligibility(input({ terms: makeTerms(spec) }));
    const f = flags.find((x) => x.ruleKey === "eligibility_clock");
    expect(f).toBeDefined();
    expect(f!.severity).toBe("warning");
  });
});

describe("checkEligibility — partial (placeholder) rulesets", () => {
  it("only runs checks whose rules are present", () => {
    const d3: EligibilityRuleset = {
      id: "rs3",
      division: "D3",
      effectiveDate: "2024-08-01",
      verified: false,
      sourceNote: "placeholder",
      rules: { full_time_min_credits: 12 },
    };
    const terms = compliantTerms();
    terms[0].totalCredits = 9; // violates full-time only
    const flags = checkEligibility(input({ terms, ruleset: d3 }));
    expect(flags.some((f) => f.ruleKey === "full_time_enrollment")).toBe(true);
    expect(flags.some((f) => f.ruleKey === "annual_hours")).toBe(false);
    expect(flags.some((f) => f.ruleKey.startsWith("ptd_"))).toBe(false);
    expect(flags.some((f) => f.ruleKey === "ruleset_unverified")).toBe(true);
  });
});
