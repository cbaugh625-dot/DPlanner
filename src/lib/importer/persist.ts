import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import {
  academicTermsConfig,
  athleticCalendars,
  courseOfferings,
  courses,
  institutions,
  prerequisites,
  programRequirementCourses,
  programs,
  requirementCategories,
} from "@/db/schema";
import type { CatalogBundle } from "./types";

export interface PersistSummary {
  institutionId: string;
  programs: number;
  categories: number;
  courses: number;
  prerequisites: number;
  mappings: number;
  athleticCalendars: number;
}

/**
 * Idempotently persist a validated catalog bundle. Re-running upserts by
 * natural key (institution slug, program slug, course code, …) and replaces
 * child collections — it never duplicates rows.
 */
export async function persistCatalog(
  db: Db,
  bundle: CatalogBundle,
): Promise<PersistSummary> {
  return db.transaction(async (tx) => {
    // Institution ------------------------------------------------------------
    const [inst] = await tx
      .insert(institutions)
      .values({
        slug: bundle.institution.slug,
        name: bundle.institution.name,
        division: bundle.institution.division,
        minGraduationGpa: bundle.institution.minGraduationGpa.toFixed(2),
        defaultDegreeCredits: bundle.institution.defaultDegreeCredits,
        settings: bundle.institution.settings,
      })
      .onConflictDoUpdate({
        target: institutions.slug,
        set: {
          name: bundle.institution.name,
          division: bundle.institution.division,
          minGraduationGpa: bundle.institution.minGraduationGpa.toFixed(2),
          defaultDegreeCredits: bundle.institution.defaultDegreeCredits,
          settings: bundle.institution.settings,
        },
      })
      .returning({ id: institutions.id });
    const institutionId = inst.id;

    // Terms config (replace) ---------------------------------------------------
    await tx
      .delete(academicTermsConfig)
      .where(eq(academicTermsConfig.institutionId, institutionId));
    await tx.insert(academicTermsConfig).values(
      bundle.institution.terms.map((t) => ({
        institutionId,
        termType: t.termType,
        minCredits: t.minCredits,
        maxCredits: t.maxCredits,
        fullTimeThreshold: t.fullTimeThreshold,
      })),
    );

    // Programs -----------------------------------------------------------------
    const programIdBySlug = new Map<string, string>();
    for (const p of bundle.programs) {
      const [row] = await tx
        .insert(programs)
        .values({
          institutionId,
          slug: p.slug,
          name: p.name,
          degreeType: p.degreeType,
          catalogYear: p.catalogYear,
          totalCreditsRequired: p.totalCreditsRequired,
          type: p.type,
        })
        .onConflictDoUpdate({
          target: [programs.institutionId, programs.slug],
          set: {
            name: p.name,
            degreeType: p.degreeType,
            catalogYear: p.catalogYear,
            totalCreditsRequired: p.totalCreditsRequired,
            type: p.type,
          },
        })
        .returning({ id: programs.id });
      programIdBySlug.set(p.slug, row.id);
    }

    // Courses + offerings --------------------------------------------------------
    const courseIdByCode = new Map<string, string>();
    for (const c of bundle.courses) {
      const [row] = await tx
        .insert(courses)
        .values({
          institutionId,
          code: c.code,
          title: c.title,
          credits: c.credits,
          description: c.description,
          difficulty: c.difficulty,
        })
        .onConflictDoUpdate({
          target: [courses.institutionId, courses.code],
          set: {
            title: c.title,
            credits: c.credits,
            description: c.description,
            difficulty: c.difficulty,
          },
        })
        .returning({ id: courses.id });
      courseIdByCode.set(c.code, row.id);

      await tx
        .insert(courseOfferings)
        .values({
          courseId: row.id,
          offeredFall: c.offeredFall,
          offeredSpring: c.offeredSpring,
          offeredSummer: c.offeredSummer,
          offeredWinter: c.offeredWinter,
          cadence: c.cadence,
        })
        .onConflictDoUpdate({
          target: courseOfferings.courseId,
          set: {
            offeredFall: c.offeredFall,
            offeredSpring: c.offeredSpring,
            offeredSummer: c.offeredSummer,
            offeredWinter: c.offeredWinter,
            cadence: c.cadence,
          },
        });
    }

    // Requirement categories -------------------------------------------------------
    const categoryIdByKey = new Map<string, string>();
    for (const cat of bundle.categories) {
      const programId = programIdBySlug.get(cat.programSlug)!;
      const [row] = await tx
        .insert(requirementCategories)
        .values({
          programId,
          slug: cat.slug,
          name: cat.name,
          creditsRequired: cat.creditsRequired,
          ruleType: cat.ruleType,
          ruleValue: cat.ruleValue,
          sortOrder: cat.sortOrder,
        })
        .onConflictDoUpdate({
          target: [requirementCategories.programId, requirementCategories.slug],
          set: {
            name: cat.name,
            creditsRequired: cat.creditsRequired,
            ruleType: cat.ruleType,
            ruleValue: cat.ruleValue,
            sortOrder: cat.sortOrder,
          },
        })
        .returning({ id: requirementCategories.id });
      categoryIdByKey.set(`${cat.programSlug}::${cat.slug}`, row.id);
    }

    // Prerequisites (replace per imported course) ------------------------------------
    const importedCourseIds = [...courseIdByCode.values()];
    if (importedCourseIds.length > 0) {
      await tx
        .delete(prerequisites)
        .where(inArray(prerequisites.courseId, importedCourseIds));
    }
    if (bundle.prerequisites.length > 0) {
      await tx.insert(prerequisites).values(
        bundle.prerequisites.map((p) => ({
          courseId: courseIdByCode.get(p.courseCode)!,
          prereqExpression: p.expression,
          type: p.type,
          minGrade: p.minGrade,
        })),
      );
    }

    // Requirement mappings (replace per imported category) -----------------------------
    const importedCategoryIds = [...categoryIdByKey.values()];
    if (importedCategoryIds.length > 0) {
      await tx
        .delete(programRequirementCourses)
        .where(
          inArray(
            programRequirementCourses.requirementCategoryId,
            importedCategoryIds,
          ),
        );
    }
    if (bundle.mappings.length > 0) {
      await tx.insert(programRequirementCourses).values(
        bundle.mappings.map((m) => ({
          requirementCategoryId: categoryIdByKey.get(
            `${m.programSlug}::${m.categorySlug}`,
          )!,
          courseId: courseIdByCode.get(m.courseCode)!,
        })),
      );
    }

    // Athletic calendars ------------------------------------------------------------
    for (const cal of bundle.athleticCalendars) {
      await tx
        .insert(athleticCalendars)
        .values({
          institutionId,
          sport: cal.sport,
          championshipTerms: cal.championshipTerms,
          inSeasonWeeks: cal.inSeasonWeeks,
          practiceBlocks: cal.practiceBlocks,
          typicalTravelPattern: cal.typicalTravelPattern,
        })
        .onConflictDoUpdate({
          target: [athleticCalendars.institutionId, athleticCalendars.sport],
          set: {
            championshipTerms: cal.championshipTerms,
            inSeasonWeeks: cal.inSeasonWeeks,
            practiceBlocks: cal.practiceBlocks,
            typicalTravelPattern: cal.typicalTravelPattern,
          },
        });
    }

    return {
      institutionId,
      programs: bundle.programs.length,
      categories: bundle.categories.length,
      courses: bundle.courses.length,
      prerequisites: bundle.prerequisites.length,
      mappings: bundle.mappings.length,
      athleticCalendars: bundle.athleticCalendars.length,
    };
  });
}
