import { describe, expect, it } from "vitest";
import { parseCatalog } from "./parse";
import type { RawImportFiles } from "./types";

function validFiles(): RawImportFiles {
  return {
    "institution.json": JSON.stringify({
      slug: "demo-u",
      name: "Demo University",
      division: "D1",
      min_graduation_gpa: 2.0,
      default_degree_credits: 120,
      settings: {},
      terms: [
        { term_type: "fall", min_credits: 12, max_credits: 18, full_time_threshold: 12 },
        { term_type: "spring", min_credits: 12, max_credits: 18, full_time_threshold: 12 },
        { term_type: "summer", min_credits: 0, max_credits: 9, full_time_threshold: null },
      ],
    }),
    "programs.csv":
      "slug,name,degree_type,catalog_year,total_credits_required,type\n" +
      "hist-ba,History,BA,2025-2026,12,major\n",
    "requirement_categories.csv":
      "program_slug,slug,name,credits_required,rule_type,rule_value,sort_order\n" +
      "hist-ba,core,Major Core,6,all_of,,1\n" +
      "hist-ba,elect,Electives,6,choose_n_courses,2,2\n",
    "courses.csv":
      "code,title,credits,description,difficulty,offered_fall,offered_spring,offered_summer,offered_winter,cadence\n" +
      "HIST 1001,World History I,3,,2,true,true,false,false,every_year\n" +
      "HIST 1002,World History II,3,,2,false,true,false,false,every_year\n" +
      "HIST 2001,Historiography,3,,3,true,false,false,false,alternate_years_odd\n" +
      "HIST 2002,Public History,3,,2,true,true,true,false,every_year\n" +
      "HIST 3001,Seminar,3,,4,true,true,false,false,every_year\n",
    "prerequisites.csv":
      "course_code,type,min_grade,expression\n" +
      "HIST 1002,prerequisite,C,HIST 1001\n" +
      "HIST 3001,prerequisite,,HIST 1001 AND (HIST 1002 OR HIST 2001)\n",
    "requirement_mapping.csv":
      "program_slug,category_slug,course_code\n" +
      "hist-ba,core,HIST 1001\n" +
      "hist-ba,core,HIST 1002\n" +
      "hist-ba,elect,HIST 2001\n" +
      "hist-ba,elect,HIST 2002\n" +
      "hist-ba,elect,HIST 3001\n",
    "athletic_calendars.csv":
      "sport,championship_terms,in_season_weeks,practice_blocks,typical_travel_pattern\n" +
      'Football,fall,"[{""start"":""2025-09-01"",""end"":""2025-12-01""}]","[]","{}"\n',
  };
}

describe("parseCatalog — valid data", () => {
  it("returns a bundle and no errors", () => {
    const { bundle, errors } = parseCatalog(validFiles());
    expect(errors).toEqual([]);
    expect(bundle).not.toBeNull();
    expect(bundle!.institution.slug).toBe("demo-u");
    expect(bundle!.courses).toHaveLength(5);
    expect(bundle!.prerequisites).toHaveLength(2);
    expect(bundle!.prerequisites[1].expression).toEqual({
      and: [
        { course: "HIST 1001" },
        { or: [{ course: "HIST 1002" }, { course: "HIST 2001" }] },
      ],
    });
    expect(bundle!.athleticCalendars[0].championshipTerms).toEqual(["fall"]);
  });
});

describe("parseCatalog — malformed data", () => {
  it("reports ALL errors at once and imports nothing", () => {
    const files = validFiles();
    // 1: dangling prereq reference
    files["prerequisites.csv"] +=
      "HIST 2001,prerequisite,,HIST 9999\n" +
      // 2: prereq for a course that doesn't exist
      "HIST 8888,prerequisite,,HIST 1001\n";
    // 3: mapping to a missing course
    files["requirement_mapping.csv"] += "hist-ba,core,HIST 7777\n";
    // 4: duplicate mapping row
    files["requirement_mapping.csv"] += "hist-ba,core,HIST 1001\n";
    // 5: duplicate course row
    files["courses.csv"] +=
      "HIST 1001,Duplicate,3,,2,true,true,false,false,every_year\n";

    const { bundle, errors } = parseCatalog(files);
    expect(bundle).toBeNull();
    expect(errors.length).toBeGreaterThanOrEqual(5);
    const messages = errors.map((e) => `${e.file}: ${e.message}`).join("\n");
    expect(messages).toContain('unknown course "HIST 9999"');
    expect(messages).toContain('"HIST 8888" does not match any course');
    expect(messages).toContain('"HIST 7777" does not match any course');
    expect(messages).toContain("duplicate mapping row");
    expect(messages).toContain('duplicate course code "HIST 1001"');
  });

  it("flags a category with no mapped courses", () => {
    const files = validFiles();
    files["requirement_categories.csv"] +=
      "hist-ba,capstone,Capstone,3,all_of,,3\n";
    const { bundle, errors } = parseCatalog(files);
    expect(bundle).toBeNull();
    expect(errors.some((e) => e.message.includes('"capstone"'))).toBe(true);
  });

  it("flags a category whose mapped credits cannot satisfy it", () => {
    const files = validFiles();
    files["requirement_categories.csv"] =
      "program_slug,slug,name,credits_required,rule_type,rule_value,sort_order\n" +
      "hist-ba,core,Major Core,60,all_of,,1\n" +
      "hist-ba,elect,Electives,6,choose_n_courses,2,2\n";
    const { bundle, errors } = parseCatalog(files);
    expect(bundle).toBeNull();
    expect(
      errors.some((e) => e.message.includes("requires 60 credits")),
    ).toBe(true);
  });

  it("flags invalid enums, credits, self-prereqs, and missing columns", () => {
    const files = validFiles();
    files["programs.csv"] =
      "slug,name,degree_type,catalog_year,total_credits_required,type\n" +
      "hist-ba,History,BA,2025-2026,zero,degree\n";
    files["prerequisites.csv"] =
      "course_code,type,min_grade,expression\n" +
      "HIST 1001,prerequisite,,HIST 1001\n";
    files["athletic_calendars.csv"] =
      "sport,championship_terms,in_season_weeks,practice_blocks,typical_travel_pattern\n" +
      'Football,autumn,"not json","[]","{}"\n';
    const { bundle, errors } = parseCatalog(files);
    expect(bundle).toBeNull();
    const messages = errors.map((e) => e.message).join("\n");
    expect(messages).toContain("total_credits_required must be a positive integer");
    expect(messages).toContain('type must be "major" or "minor"');
    expect(messages).toContain("cannot be its own prerequisite");
    expect(messages).toContain('invalid term type "autumn"');
    expect(messages).toContain("invalid JSON");
  });

  it("reports a missing file", () => {
    const files = validFiles();
    // @ts-expect-error simulating a missing file
    files["courses.csv"] = undefined;
    const { bundle, errors } = parseCatalog(files);
    expect(bundle).toBeNull();
    expect(
      errors.some((e) => e.file === "courses.csv" && e.message === "file is missing"),
    ).toBe(true);
  });
});
