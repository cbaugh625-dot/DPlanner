import type {
  Cadence,
  Division,
  PrereqExpr,
  RequirementRuleType,
  TermType,
} from "../types";

/** One problem found during import. All problems are reported at once. */
export interface ImportError {
  file: string;
  line?: number;
  field?: string;
  message: string;
}

/** Raw file contents handed to the importer. */
export interface RawImportFiles {
  "institution.json": string;
  "programs.csv": string;
  "requirement_categories.csv": string;
  "courses.csv": string;
  "prerequisites.csv": string;
  "requirement_mapping.csv": string;
  "athletic_calendars.csv": string;
}

// --- Validated, id-less bundle (natural keys: slugs + course codes) --------

export interface BundleInstitution {
  slug: string;
  name: string;
  division: Division;
  minGraduationGpa: number;
  defaultDegreeCredits: number;
  settings: Record<string, unknown>;
  terms: {
    termType: TermType;
    minCredits: number;
    maxCredits: number;
    fullTimeThreshold: number | null;
  }[];
}

export interface BundleProgram {
  slug: string;
  name: string;
  degreeType: string;
  catalogYear: string;
  totalCreditsRequired: number;
  type: "major" | "minor";
}

export interface BundleCategory {
  programSlug: string;
  slug: string;
  name: string;
  creditsRequired: number;
  ruleType: RequirementRuleType;
  ruleValue: number | null;
  sortOrder: number;
}

export interface BundleCourse {
  code: string;
  title: string;
  credits: number;
  description: string | null;
  difficulty: number | null;
  offeredFall: boolean;
  offeredSpring: boolean;
  offeredSummer: boolean;
  offeredWinter: boolean;
  cadence: Cadence;
}

export interface BundlePrerequisite {
  courseCode: string;
  type: "prerequisite" | "corequisite";
  minGrade: string | null;
  expression: PrereqExpr;
}

export interface BundleMapping {
  programSlug: string;
  categorySlug: string;
  courseCode: string;
}

export interface BundleAthleticCalendar {
  sport: string;
  championshipTerms: TermType[];
  inSeasonWeeks: unknown[];
  practiceBlocks: unknown[];
  typicalTravelPattern: Record<string, unknown>;
}

export interface CatalogBundle {
  institution: BundleInstitution;
  programs: BundleProgram[];
  categories: BundleCategory[];
  courses: BundleCourse[];
  prerequisites: BundlePrerequisite[];
  mappings: BundleMapping[];
  athleticCalendars: BundleAthleticCalendar[];
}

export interface ParseResult {
  bundle: CatalogBundle | null;
  errors: ImportError[];
}
