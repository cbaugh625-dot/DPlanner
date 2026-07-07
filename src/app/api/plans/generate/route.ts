import { NextResponse } from "next/server";
import {
  getActiveRuleset,
  getAthleticCalendar,
  getCoursesForInstitution,
  getInstitution,
  getProgramsWithCategories,
  getStudent,
} from "@/lib/data";
import { checkEligibility, sortFlags } from "@/lib/eligibility";
import { generatePlan } from "@/lib/scheduler";
import { checkAthleticLoad } from "@/lib/scheduler/athletics";
import { parseTermLabel } from "@/lib/types";
import type { GradTarget, Strategy } from "@/lib/types";

interface GenerateBody {
  institutionId: string;
  programId: string;
  secondaryProgramId?: string | null;
  minorProgramIds?: string[];
  studentId: string;
  target: GradTarget;
  strategy: Strategy;
  options?: {
    inSeasonMaxCredits?: number;
    ptdDenominator?: "primary_only" | "combined";
    studyAbroadTerms?: string[];
  };
}

/**
 * Generates a plan on the fly. Nothing is persisted — the advisor stays in
 * control and no plan becomes a record unless explicitly saved (not in v1).
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as GenerateBody;
    if (!body.institutionId || !body.programId || !body.studentId) {
      return NextResponse.json(
        { error: "institutionId, programId and studentId are required" },
        { status: 400 },
      );
    }

    const [institution, student, courses] = await Promise.all([
      getInstitution(body.institutionId),
      getStudent(body.studentId, body.institutionId),
      getCoursesForInstitution(body.institutionId),
    ]);
    if (!institution) {
      return NextResponse.json({ error: "Institution not found" }, { status: 404 });
    }
    if (!student) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const programIds = [
      body.programId,
      ...(body.secondaryProgramId ? [body.secondaryProgramId] : []),
      ...(body.minorProgramIds ?? []),
    ];
    const programsWithCats = await getProgramsWithCategories(
      programIds,
      body.institutionId,
    );
    const program = programsWithCats.find((p) => p.id === body.programId);
    if (!program) {
      return NextResponse.json({ error: "Program not found" }, { status: 404 });
    }
    const secondaryProgram = body.secondaryProgramId
      ? programsWithCats.find((p) => p.id === body.secondaryProgramId) ?? null
      : null;
    const minors = (body.minorProgramIds ?? [])
      .map((id) => programsWithCats.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => !!p);

    const athleticCalendar = await getAthleticCalendar(
      body.institutionId,
      student.sport,
    );

    const result = generatePlan({
      institution,
      program,
      secondaryProgram,
      minors,
      courses,
      student,
      target: body.target ?? "grad_4yr",
      strategy: body.strategy ?? "balanced",
      athleticCalendar,
      options: body.options,
    });

    // Eligibility: always run the authoritative check against the active
    // ruleset for the student's division + enrollment date.
    let enrollmentDate = "2024-08-01";
    try {
      const t = parseTermLabel(student.enrollmentStartTerm);
      enrollmentDate = `${t.year}-08-01`;
    } catch {
      // keep default
    }
    const ruleset = await getActiveRuleset(student.division, enrollmentDate);
    const incomingCreditHours = student.incomingCredits.reduce(
      (s, c) => s + c.credits,
      0,
    );
    const eligibilityFlags = ruleset
      ? checkEligibility({
          terms: result.terms,
          student: { currentCumulativeGpa: student.currentCumulativeGpa },
          institution: { minGraduationGpa: institution.minGraduationGpa },
          ruleset,
          totalCreditsRequired: result.totalCreditsRequired,
          incomingCreditHours,
          incomingDegreeCredits: result.incomingDegreeCredits,
        })
      : [];
    const athleticFlags = checkAthleticLoad(
      result.terms,
      athleticCalendar,
      new Map(courses.map((c) => [c.id, c])),
      { inSeasonMaxCredits: body.options?.inSeasonMaxCredits },
    );
    if (secondaryProgram) {
      eligibilityFlags.push({
        term: null,
        severity: "info",
        ruleKey: "double_major_ptd_denominator",
        message:
          body.options?.ptdDenominator === "combined"
            ? `Double major: percentage-of-degree is computed against the COMBINED requirements of both majors (${result.totalCreditsRequired} hours). The NCAA gives the institution discretion here — confirm the treatment with compliance.`
            : `Double major: percentage-of-degree is computed against the PRIMARY major only (${result.totalCreditsRequired} hours). The NCAA gives the institution discretion here — confirm the treatment with compliance.`,
      });
    }
    const flags = sortFlags([...eligibilityFlags, ...athleticFlags]);

    // Lightweight course index for rendering.
    const usedIds = new Set<string>(result.terms.flatMap((t) => t.courseIds));
    for (const id of result.unscheduledCourseIds) usedIds.add(id);
    const courseIndex = Object.fromEntries(
      courses
        .filter((c) => usedIds.has(c.id))
        .map((c) => [
          c.id,
          {
            code: c.code,
            title: c.title,
            credits: c.credits,
            difficulty: c.difficulty ?? null,
          },
        ]),
    );

    return NextResponse.json({
      result,
      flags,
      ruleset: ruleset
        ? {
            id: ruleset.id,
            division: ruleset.division,
            effectiveDate: ruleset.effectiveDate,
            verified: ruleset.verified,
            sourceNote: ruleset.sourceNote,
          }
        : null,
      courseIndex,
      student: {
        id: student.id,
        displayName: student.displayName,
        sport: student.sport,
        division: student.division,
        enrollmentStartTerm: student.enrollmentStartTerm,
        currentCumulativeGpa: student.currentCumulativeGpa,
      },
      program: { id: program.id, name: program.name, degreeType: program.degreeType },
      secondaryProgram: secondaryProgram
        ? { id: secondaryProgram.id, name: secondaryProgram.name }
        : null,
      minors: minors.map((m) => ({ id: m.id, name: m.name })),
      athleticCalendar,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
