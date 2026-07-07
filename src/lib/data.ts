/**
 * Server-side data access: maps DB rows into the pure domain types consumed
 * by the scheduler and eligibility engines. Everything is scoped by
 * institution_id (multi-tenant).
 */
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  academicTermsConfig,
  athleticCalendars,
  courseOfferings,
  courses,
  eligibilityRulesets,
  incomingCredits,
  institutions,
  prerequisites,
  programRequirementCourses,
  programs,
  requirementCategories,
  students,
} from "@/db/schema";
import type {
  AthleticCalendar,
  Course,
  Division,
  EligibilityRuleset,
  Institution,
  PrereqExpr,
  Program,
  Student,
  TermType,
} from "./types";

export async function listInstitutions() {
  return db
    .select({
      id: institutions.id,
      slug: institutions.slug,
      name: institutions.name,
      division: institutions.division,
    })
    .from(institutions)
    .orderBy(asc(institutions.name));
}

export async function getInstitution(institutionId: string): Promise<Institution | null> {
  const rows = await db
    .select()
    .from(institutions)
    .where(eq(institutions.id, institutionId));
  if (rows.length === 0) return null;
  const terms = await db
    .select()
    .from(academicTermsConfig)
    .where(eq(academicTermsConfig.institutionId, institutionId));
  const r = rows[0];
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    division: r.division as Division,
    minGraduationGpa: Number(r.minGraduationGpa),
    defaultDegreeCredits: r.defaultDegreeCredits,
    terms: terms.map((t) => ({
      termType: t.termType as TermType,
      minCredits: t.minCredits,
      maxCredits: t.maxCredits,
      fullTimeThreshold: t.fullTimeThreshold,
    })),
  };
}

export async function listProgramsForInstitution(institutionId: string) {
  return db
    .select({
      id: programs.id,
      slug: programs.slug,
      name: programs.name,
      degreeType: programs.degreeType,
      type: programs.type,
      totalCreditsRequired: programs.totalCreditsRequired,
      catalogYear: programs.catalogYear,
    })
    .from(programs)
    .where(eq(programs.institutionId, institutionId))
    .orderBy(asc(programs.name));
}

export async function getProgramsWithCategories(
  programIds: string[],
): Promise<Program[]> {
  if (programIds.length === 0) return [];
  const progRows = await db
    .select()
    .from(programs)
    .where(inArray(programs.id, programIds));
  const catRows = await db
    .select()
    .from(requirementCategories)
    .where(inArray(requirementCategories.programId, programIds))
    .orderBy(asc(requirementCategories.sortOrder));
  const catIds = catRows.map((c) => c.id);
  const mappingRows =
    catIds.length > 0
      ? await db
          .select()
          .from(programRequirementCourses)
          .where(inArray(programRequirementCourses.requirementCategoryId, catIds))
      : [];
  return progRows.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    degreeType: p.degreeType,
    catalogYear: p.catalogYear,
    totalCreditsRequired: p.totalCreditsRequired,
    type: p.type,
    categories: catRows
      .filter((c) => c.programId === p.id)
      .map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        creditsRequired: c.creditsRequired,
        ruleType: c.ruleType,
        ruleValue: c.ruleValue,
        sortOrder: c.sortOrder,
        courseIds: mappingRows
          .filter((m) => m.requirementCategoryId === c.id)
          .map((m) => m.courseId),
      })),
  }));
}

export async function getCoursesForInstitution(
  institutionId: string,
): Promise<Course[]> {
  const courseRows = await db
    .select()
    .from(courses)
    .where(eq(courses.institutionId, institutionId));
  const ids = courseRows.map((c) => c.id);
  if (ids.length === 0) return [];
  const offeringRows = await db
    .select()
    .from(courseOfferings)
    .where(inArray(courseOfferings.courseId, ids));
  const prereqRows = await db
    .select()
    .from(prerequisites)
    .where(inArray(prerequisites.courseId, ids));
  const offeringByCourse = new Map(offeringRows.map((o) => [o.courseId, o]));
  return courseRows.map((c) => {
    const o = offeringByCourse.get(c.id);
    return {
      id: c.id,
      code: c.code,
      title: c.title,
      credits: c.credits,
      description: c.description,
      difficulty: c.difficulty,
      offering: {
        fall: o?.offeredFall ?? false,
        spring: o?.offeredSpring ?? false,
        summer: o?.offeredSummer ?? false,
        winter: o?.offeredWinter ?? false,
        cadence: o?.cadence ?? "every_year",
      },
      prerequisites: prereqRows
        .filter((p) => p.courseId === c.id)
        .map((p) => ({
          type: p.type,
          expression: p.prereqExpression as PrereqExpr,
          minGrade: p.minGrade,
        })),
    };
  });
}

export async function listStudentsForInstitution(institutionId: string) {
  const rows = await db
    .select()
    .from(students)
    .where(eq(students.institutionId, institutionId))
    .orderBy(asc(students.displayName));
  const ids = rows.map((s) => s.id);
  const creditRows =
    ids.length > 0
      ? await db
          .select()
          .from(incomingCredits)
          .where(inArray(incomingCredits.studentId, ids))
      : [];
  return rows.map((s) => ({
    id: s.id,
    slug: s.slug,
    displayName: s.displayName,
    sport: s.sport,
    division: s.division as Division,
    enrollmentStartTerm: s.enrollmentStartTerm,
    currentCumulativeGpa: s.currentCumulativeGpa
      ? Number(s.currentCumulativeGpa)
      : null,
    isSample: s.isSample,
    incomingCredits: creditRows
      .filter((c) => c.studentId === s.id)
      .map((c) => ({
        source: c.source,
        satisfiesCourseId: c.satisfiesCourseId,
        satisfiesRequirementCategoryId: c.satisfiesRequirementCategoryId,
        credits: c.credits,
        grade: c.grade,
      })),
  }));
}

export async function getStudent(studentId: string): Promise<Student | null> {
  const rows = await db.select().from(students).where(eq(students.id, studentId));
  if (rows.length === 0) return null;
  const s = rows[0];
  const creditRows = await db
    .select()
    .from(incomingCredits)
    .where(eq(incomingCredits.studentId, studentId));
  return {
    id: s.id,
    displayName: s.displayName,
    sport: s.sport,
    division: s.division as Division,
    enrollmentStartTerm: s.enrollmentStartTerm,
    currentCumulativeGpa: s.currentCumulativeGpa
      ? Number(s.currentCumulativeGpa)
      : null,
    incomingCredits: creditRows.map((c) => ({
      source: c.source,
      satisfiesCourseId: c.satisfiesCourseId,
      satisfiesRequirementCategoryId: c.satisfiesRequirementCategoryId,
      credits: c.credits,
      grade: c.grade,
    })),
  };
}

export async function getAthleticCalendar(
  institutionId: string,
  sport: string,
): Promise<AthleticCalendar | null> {
  const rows = await db
    .select()
    .from(athleticCalendars)
    .where(eq(athleticCalendars.institutionId, institutionId));
  const match = rows.find((r) => r.sport === sport);
  if (!match) return null;
  return {
    sport: match.sport,
    championshipTerms: match.championshipTerms as TermType[],
    inSeasonWeeks: match.inSeasonWeeks as AthleticCalendar["inSeasonWeeks"],
    practiceBlocks: match.practiceBlocks as AthleticCalendar["practiceBlocks"],
    typicalTravelPattern:
      match.typicalTravelPattern as AthleticCalendar["typicalTravelPattern"],
  };
}

/**
 * Active ruleset for a division at a given date: the most recent
 * effective_date that is ≤ the reference date (falls back to the earliest
 * ruleset if none is in effect yet).
 */
export async function getActiveRuleset(
  division: Division,
  referenceDate: string,
): Promise<EligibilityRuleset | null> {
  const rows = await db
    .select()
    .from(eligibilityRulesets)
    .where(eq(eligibilityRulesets.division, division));
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) =>
    a.effectiveDate < b.effectiveDate ? -1 : 1,
  );
  const active =
    [...sorted].reverse().find((r) => r.effectiveDate <= referenceDate) ??
    sorted[0];
  return {
    id: active.id,
    division: active.division as Division,
    effectiveDate: active.effectiveDate,
    rules: active.rules as EligibilityRuleset["rules"],
    sourceNote: active.sourceNote,
    verified: active.verified,
  };
}
