/**
 * Convert a validated import bundle into pure domain objects (no DB needed).
 * Used by tests and anywhere a catalog needs to be materialized in memory.
 * IDs are synthesized from natural keys.
 */
import type { CatalogBundle } from "./importer/types";
import type {
  AthleticCalendar,
  Course,
  Institution,
  Program,
} from "./types";

export interface DomainCatalog {
  institution: Institution;
  programs: Program[];
  courses: Course[];
  athleticCalendars: AthleticCalendar[];
}

export function bundleToDomain(bundle: CatalogBundle): DomainCatalog {
  const institution: Institution = {
    id: `inst:${bundle.institution.slug}`,
    slug: bundle.institution.slug,
    name: bundle.institution.name,
    division: bundle.institution.division,
    minGraduationGpa: bundle.institution.minGraduationGpa,
    defaultDegreeCredits: bundle.institution.defaultDegreeCredits,
    terms: bundle.institution.terms.map((t) => ({
      termType: t.termType,
      minCredits: t.minCredits,
      maxCredits: t.maxCredits,
      fullTimeThreshold: t.fullTimeThreshold,
    })),
  };

  const courseId = (code: string) => `course:${code}`;
  const courses: Course[] = bundle.courses.map((c) => ({
    id: courseId(c.code),
    code: c.code,
    title: c.title,
    credits: c.credits,
    description: c.description,
    difficulty: c.difficulty,
    offering: {
      fall: c.offeredFall,
      spring: c.offeredSpring,
      summer: c.offeredSummer,
      winter: c.offeredWinter,
      cadence: c.cadence,
    },
    prerequisites: bundle.prerequisites
      .filter((p) => p.courseCode === c.code)
      .map((p) => ({
        type: p.type,
        expression: p.expression,
        minGrade: p.minGrade,
      })),
  }));

  const programs: Program[] = bundle.programs.map((p) => ({
    id: `program:${p.slug}`,
    slug: p.slug,
    name: p.name,
    degreeType: p.degreeType,
    catalogYear: p.catalogYear,
    totalCreditsRequired: p.totalCreditsRequired,
    type: p.type,
    categories: bundle.categories
      .filter((c) => c.programSlug === p.slug)
      .map((c) => ({
        id: `cat:${p.slug}:${c.slug}`,
        slug: c.slug,
        name: c.name,
        creditsRequired: c.creditsRequired,
        ruleType: c.ruleType,
        ruleValue: c.ruleValue,
        sortOrder: c.sortOrder,
        courseIds: bundle.mappings
          .filter(
            (m) => m.programSlug === p.slug && m.categorySlug === c.slug,
          )
          .map((m) => courseId(m.courseCode)),
      })),
  }));

  const athleticCalendars: AthleticCalendar[] = bundle.athleticCalendars.map(
    (a) => ({
      sport: a.sport,
      championshipTerms: a.championshipTerms,
      inSeasonWeeks: a.inSeasonWeeks as AthleticCalendar["inSeasonWeeks"],
      practiceBlocks: a.practiceBlocks as AthleticCalendar["practiceBlocks"],
      typicalTravelPattern:
        a.typicalTravelPattern as AthleticCalendar["typicalTravelPattern"],
    }),
  );

  return { institution, programs, courses, athleticCalendars };
}
