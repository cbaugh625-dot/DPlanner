/**
 * Integration tests: run the scheduler against the actual LSU seed catalog
 * (parsed straight from the import files — no DB required).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCatalog } from "../importer/parse";
import type { RawImportFiles } from "../importer/types";
import { bundleToDomain, type DomainCatalog } from "../catalog";
import { evaluateExpression } from "../importer/prereqExpr";
import { generatePlan } from "./engine";
import { isPrimaryTerm } from "./terms";
import { isOfferedInTerm } from "./terms";
import type { Student } from "../types";

function loadLsu(): DomainCatalog {
  const dir = join(process.cwd(), "seed-data", "lsu");
  const read = (f: string) => readFileSync(join(dir, f), "utf8");
  const files: RawImportFiles = {
    "institution.json": read("institution.json"),
    "programs.csv": read("programs.csv"),
    "requirement_categories.csv": read("requirement_categories.csv"),
    "courses.csv": read("courses.csv"),
    "prerequisites.csv": read("prerequisites.csv"),
    "requirement_mapping.csv": read("requirement_mapping.csv"),
    "athletic_calendars.csv": read("athletic_calendars.csv"),
  };
  const { bundle, errors } = parseCatalog(files);
  expect(errors).toEqual([]);
  return bundleToDomain(bundle!);
}

const lsu = loadLsu();
const byCode = new Map(lsu.courses.map((c) => [c.code, c]));

function student(overrides: Partial<Student> = {}): Student {
  return {
    id: "s1",
    displayName: "Sample",
    sport: "Football",
    division: "D1",
    enrollmentStartTerm: "Fall 2025",
    currentCumulativeGpa: 3.0,
    incomingCredits: [],
    ...overrides,
  };
}

const marcusCredits = [
  { source: "AP" as const, satisfiesCourseId: byCode.get("MATH 1550")!.id, credits: 4 },
  { source: "AP" as const, satisfiesCourseId: byCode.get("ENGL 1001")!.id, credits: 3 },
];

describe("LSU seed — Mechanical Engineering (deep chains)", () => {
  it("produces a valid, feasible 4-year plan for a calc-ready student", () => {
    const result = generatePlan({
      institution: lsu.institution,
      program: lsu.programs.find((p) => p.slug === "me-bs")!,
      courses: lsu.courses,
      student: student({ incomingCredits: marcusCredits }),
      target: "grad_4yr",
      strategy: "balanced",
    });
    expect(result.dataErrors).toEqual([]);
    expect(result.feasible).toBe(true);
    expect(result.terms[result.terms.length - 1].cumulativeDegreePercent).toBe(100);

    // validate: offerings + prereq ordering hold on real data
    const completed = new Set<string>();
    for (const ic of marcusCredits) {
      completed.add(lsu.courses.find((c) => c.id === ic.satisfiesCourseId)!.code);
    }
    for (const t of result.terms) {
      const inTerm = new Set(
        t.courseIds.map((id) => lsu.courses.find((c) => c.id === id)!.code),
      );
      for (const id of t.courseIds) {
        const c = lsu.courses.find((x) => x.id === id)!;
        expect(isOfferedInTerm(c, t.term)).toBe(true);
        for (const p of c.prerequisites) {
          if (p.type === "prerequisite") {
            expect(evaluateExpression(p.expression, completed)).toBe(true);
          } else {
            expect(
              evaluateExpression(p.expression, new Set([...completed, ...inTerm])),
            ).toBe(true);
          }
        }
      }
      for (const code of inTerm) completed.add(code);
      if (isPrimaryTerm(t.term)) {
        expect(t.totalCredits).toBeGreaterThanOrEqual(12);
        expect(t.totalCredits).toBeLessThanOrEqual(19);
      }
    }
  });

  it("declares a 4-year ME target without incoming credit infeasible and returns the closest plan", () => {
    const result = generatePlan({
      institution: lsu.institution,
      program: lsu.programs.find((p) => p.slug === "me-bs")!,
      courses: lsu.courses,
      student: student(),
      target: "grad_4yr",
      strategy: "balanced",
    });
    // MATH 1021→1022→1550→1552→2065→ME 3333→ME 3633(spring-only) plus the
    // fall-only ME 3433 → ME 4621 → ME 4622 capstone chain cannot compress
    // into 8 semesters from college algebra.
    expect(result.feasible).toBe(false);
    expect(result.explanation).toBeTruthy();
    expect(result.unscheduledCourseIds).toEqual([]);
  });
});

describe("LSU seed — Sport Administration (shallow chains)", () => {
  it("produces a feasible 4-year plan with no incoming credit", () => {
    const result = generatePlan({
      institution: lsu.institution,
      program: lsu.programs.find((p) => p.slug === "spad-ba")!,
      courses: lsu.courses,
      student: student({ sport: "Baseball" }),
      target: "grad_4yr",
      strategy: "balanced",
    });
    expect(result.dataErrors).toEqual([]);
    expect(result.feasible).toBe(true);
  });

  it("honors transfer credit applied against a requirement category", () => {
    const spad = lsu.programs.find((p) => p.slug === "spad-ba")!;
    const freeElect = spad.categories.find((c) => c.slug === "free-elect")!;
    const withTransfer = generatePlan({
      institution: lsu.institution,
      program: spad,
      courses: lsu.courses,
      student: student({
        incomingCredits: [
          {
            source: "transfer",
            satisfiesRequirementCategoryId: freeElect.id,
            credits: 12,
          },
        ],
      }),
      target: "grad_4yr",
      strategy: "balanced",
    });
    const without = generatePlan({
      institution: lsu.institution,
      program: spad,
      courses: lsu.courses,
      student: student(),
      target: "grad_4yr",
      strategy: "balanced",
    });
    expect(withTransfer.incomingDegreeCredits).toBe(12);
    const credits = (r: typeof withTransfer) =>
      r.terms.reduce((s, t) => s + t.totalCredits, 0);
    expect(credits(withTransfer)).toBeLessThan(credits(without));
  });

  it("folds a minor's requirements into the plan", () => {
    const spad = lsu.programs.find((p) => p.slug === "spad-ba")!;
    const minor = lsu.programs.find((p) => p.slug === "bus-minor")!;
    const result = generatePlan({
      institution: lsu.institution,
      program: spad,
      minors: [minor],
      courses: lsu.courses,
      student: student(),
      target: "grad_4yr",
      strategy: "balanced",
    });
    expect(result.feasible).toBe(true);
    const codes = new Set(
      result.terms.flatMap((t) =>
        t.courseIds.map((id) => lsu.courses.find((c) => c.id === id)!.code),
      ),
    );
    // Minor core must be present.
    expect(codes.has("ACCT 2001")).toBe(true);
    expect(codes.has("MGT 3200")).toBe(true);
    expect(codes.has("MKT 3401")).toBe(true);
  });
});
