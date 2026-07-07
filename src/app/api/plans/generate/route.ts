import { NextResponse } from "next/server";
import {
  getAthleticCalendar,
  getCoursesForInstitution,
  getInstitution,
  getProgramsWithCategories,
  getStudent,
} from "@/lib/data";
import { generatePlan } from "@/lib/scheduler";
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
      getStudent(body.studentId),
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
    const programsWithCats = await getProgramsWithCategories(programIds);
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
