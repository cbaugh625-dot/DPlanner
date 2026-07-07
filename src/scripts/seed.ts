/**
 * Repeatable demo seed: imports the LSU catalog via the standard importer,
 * then upserts eligibility rulesets and sample students.
 *
 * ALL DATA IS ILLUSTRATIVE. Real-shaped but not any institution's live
 * catalog; every student is synthetic (is_sample = true).
 *
 * Usage: pnpm seed
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  courses,
  eligibilityRulesets,
  incomingCredits,
  programs,
  requirementCategories,
  students,
} from "@/db/schema";
import {
  parseCatalog,
  persistCatalog,
  formatErrorReport,
  type RawImportFiles,
} from "@/lib/importer";
import type { Division, IncomingCreditSource } from "@/lib/types";

const LSU_DIR = join(process.cwd(), "seed-data", "lsu");

function read(name: string): string {
  return readFileSync(join(LSU_DIR, name), "utf8");
}

async function main() {
  // 1. Catalog import (validating + idempotent) -----------------------------
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
  if (!bundle) {
    console.error(formatErrorReport(errors));
    process.exit(1);
  }
  const summary = await persistCatalog(db, bundle);
  console.log("Catalog imported:", summary);
  const institutionId = summary.institutionId;

  // 2. Eligibility rulesets ---------------------------------------------------
  const rulesetsFile = JSON.parse(
    readFileSync(join(process.cwd(), "seed-data", "rulesets.json"), "utf8"),
  ) as {
    rulesets: {
      division: Division;
      effective_date: string;
      verified: boolean;
      source_note: string;
      rules: Record<string, unknown>;
    }[];
  };
  for (const rs of rulesetsFile.rulesets) {
    const existing = await db
      .select({ id: eligibilityRulesets.id })
      .from(eligibilityRulesets)
      .where(
        and(
          eq(eligibilityRulesets.division, rs.division),
          eq(eligibilityRulesets.effectiveDate, rs.effective_date),
        ),
      );
    if (existing.length > 0) {
      await db
        .update(eligibilityRulesets)
        .set({ rules: rs.rules, sourceNote: rs.source_note })
        .where(eq(eligibilityRulesets.id, existing[0].id));
    } else {
      await db.insert(eligibilityRulesets).values({
        division: rs.division,
        effectiveDate: rs.effective_date,
        rules: rs.rules,
        sourceNote: rs.source_note,
        verified: rs.verified,
      });
    }
  }
  console.log(`Rulesets upserted: ${rulesetsFile.rulesets.length}`);

  // 3. Sample students ----------------------------------------------------------
  const studentsFile = JSON.parse(read("students.json")) as {
    students: {
      slug: string;
      display_name: string;
      sport: string;
      division: Division;
      enrollment_start_term: string;
      current_cumulative_gpa: number | null;
      incoming_credits: {
        source: IncomingCreditSource;
        satisfies_course_code?: string;
        satisfies_requirement_category?: {
          program_slug: string;
          category_slug: string;
        };
        credits: number;
        grade: string | null;
      }[];
    }[];
  };

  for (const s of studentsFile.students) {
    const [row] = await db
      .insert(students)
      .values({
        institutionId,
        slug: s.slug,
        displayName: s.display_name,
        sport: s.sport,
        division: s.division,
        enrollmentStartTerm: s.enrollment_start_term,
        currentCumulativeGpa: s.current_cumulative_gpa?.toFixed(2) ?? null,
        isSample: true,
      })
      .onConflictDoUpdate({
        target: [students.institutionId, students.slug],
        set: {
          displayName: s.display_name,
          sport: s.sport,
          division: s.division,
          enrollmentStartTerm: s.enrollment_start_term,
          currentCumulativeGpa: s.current_cumulative_gpa?.toFixed(2) ?? null,
          isSample: true,
        },
      })
      .returning({ id: students.id });

    await db.delete(incomingCredits).where(eq(incomingCredits.studentId, row.id));
    for (const ic of s.incoming_credits) {
      let satisfiesCourseId: string | null = null;
      let satisfiesRequirementCategoryId: string | null = null;
      if (ic.satisfies_course_code) {
        const found = await db
          .select({ id: courses.id })
          .from(courses)
          .where(
            and(
              eq(courses.institutionId, institutionId),
              eq(courses.code, ic.satisfies_course_code),
            ),
          );
        if (found.length === 0) {
          throw new Error(
            `students.json: unknown course code "${ic.satisfies_course_code}" for student ${s.slug}`,
          );
        }
        satisfiesCourseId = found[0].id;
      } else if (ic.satisfies_requirement_category) {
        const { program_slug, category_slug } = ic.satisfies_requirement_category;
        const found = await db
          .select({ id: requirementCategories.id })
          .from(requirementCategories)
          .innerJoin(programs, eq(requirementCategories.programId, programs.id))
          .where(
            and(
              eq(programs.institutionId, institutionId),
              eq(programs.slug, program_slug),
              eq(requirementCategories.slug, category_slug),
            ),
          );
        if (found.length === 0) {
          throw new Error(
            `students.json: unknown requirement category ${program_slug}/${category_slug} for student ${s.slug}`,
          );
        }
        satisfiesRequirementCategoryId = found[0].id;
      }
      await db.insert(incomingCredits).values({
        studentId: row.id,
        source: ic.source,
        satisfiesCourseId,
        satisfiesRequirementCategoryId,
        credits: ic.credits,
        grade: ic.grade,
      });
    }
  }
  console.log(`Sample students upserted: ${studentsFile.students.length}`);
  console.log("Seed complete.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
