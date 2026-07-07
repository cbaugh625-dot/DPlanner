# Institution Data Import Template

Institutions provide their catalog in the seven files below. The importer
validates everything up front, **reports all errors at once** (it never fails
on the first problem), and **imports nothing unless the whole set is valid**.
Re-running an import is safe: rows are upserted by natural key (institution
slug, program slug, course code, sport), never duplicated.

A complete, filled reference set lives in [`seed-data/lsu/`](../seed-data/lsu/)
(the LSU pilot — illustrative data, not a live catalog).

## 1. `institution.json`

```jsonc
{
  "slug": "lsu",                    // stable unique identifier
  "name": "Louisiana State University",
  "division": "D1",                 // D1 | D2 | D3 | NAIA
  "min_graduation_gpa": 2.0,
  "default_degree_credits": 120,
  "settings": {},                   // free-form institution settings
  "terms": [                        // one entry per schedulable term type
    { "term_type": "fall",   "min_credits": 12, "max_credits": 19, "full_time_threshold": 12 },
    { "term_type": "spring", "min_credits": 12, "max_credits": 19, "full_time_threshold": 12 },
    { "term_type": "summer", "min_credits": 0,  "max_credits": 9,  "full_time_threshold": null }
  ]
}
```

`term_type` ∈ `fall | spring | summer | winter`. `full_time_threshold` is null
for optional terms (summer/winter) with no full-time expectation.

## 2. `programs.csv`

| column | notes |
| --- | --- |
| `slug` | unique per institution, e.g. `me-bs` |
| `name` | display name |
| `degree_type` | BA / BS / BFA / `Minor` / … |
| `catalog_year` | e.g. `2025-2026` |
| `total_credits_required` | positive integer |
| `type` | `major` or `minor` |

## 3. `requirement_categories.csv`

The requirement buckets of each program.

| column | notes |
| --- | --- |
| `program_slug` | must exist in `programs.csv` |
| `slug` | unique within the program |
| `name` | e.g. "Gen Ed – Humanities" |
| `credits_required` | credits this bucket contributes to the degree |
| `rule_type` | `all_of` \| `choose_n_courses` \| `choose_n_credits` |
| `rule_value` | required for `choose_n_*`: number of courses / credits to choose |
| `sort_order` | display order (optional, integer) |

## 4. `courses.csv`

| column | notes |
| --- | --- |
| `code` | e.g. `MATH 1550`, unique per institution |
| `title` | |
| `credits` | integer 1–12 |
| `description` | optional |
| `difficulty` | optional integer 1 (easy) – 5 (hard); drives front-load / in-season strategies |
| `offered_fall` / `offered_spring` / `offered_summer` / `offered_winter` | `true`/`false` — a plan is invalid if a course lands in a term it isn't offered |
| `cadence` | `every_year` (default) \| `alternate_years_odd` \| `alternate_years_even` — odd/even refers to the **calendar year** of the term |

## 5. `prerequisites.csv`

One row per course per relationship type (combine multiple prereqs into one
expression).

| column | notes |
| --- | --- |
| `course_code` | the course that HAS the requirement |
| `type` | `prerequisite` (strictly earlier term) or `corequisite` (same term or earlier) |
| `min_grade` | optional, e.g. `C` |
| `expression` | boolean expression — see below |

### Expression syntax

Two equivalent forms are accepted:

**Compact infix** (recommended for CSV authoring):

```
MATH 1550 AND (ENGL 1001 OR ENGL 1004)
```

- Operands are course codes exactly as they appear in `courses.csv`.
- `AND` binds tighter than `OR`; parentheses group; operators are
  case-insensitive.

**JSON boolean tree** (detected by a leading `{`):

```json
{"and":[{"course":"MATH 1550"},{"or":[{"course":"ENGL 1001"},{"course":"ENGL 1004"}]}]}
```

Every referenced course must exist; a course may not reference itself.

## 6. `requirement_mapping.csv`

Which courses can satisfy which requirement bucket.

| column | notes |
| --- | --- |
| `program_slug` | |
| `category_slug` | must exist for that program in `requirement_categories.csv` |
| `course_code` | must exist in `courses.csv` |

Validation checks that every category has mapped courses whose combined
credits can actually satisfy `credits_required`.

## 7. `athletic_calendars.csv`

| column | notes |
| --- | --- |
| `sport` | unique per institution |
| `championship_terms` | pipe-separated term types holding the competition season, e.g. `fall` or `fall\|spring` |
| `in_season_weeks` | JSON array: `[{"start":"2025-08-25","end":"2025-12-06","label":"…"}]` |
| `practice_blocks` | JSON array: `[{"days":["Mon","Wed"],"start":"06:00","end":"09:30","label":"…"}]` |
| `typical_travel_pattern` | JSON object: `{"description":"…","daysPerWeekInSeason":2}` |

JSON cells must be quoted per CSV rules (embedded `"` doubled to `""`).

## Error report

Validation problems are returned as a grouped, human-readable report, e.g.:

```
Import failed with 3 error(s). Nothing was imported.

prerequisites.csv:
  - expression references unknown course "HIST 9999" (line 4, expression)
courses.csv:
  - duplicate course code "HIST 1001" (line 7, code)
requirement_mapping.csv:
  - category "capstone" of program "hist-ba" has no courses mapped to it
```

## Not part of the template

- `seed-data/lsu/students.json` — sample students are **seed/demo-only**;
  real institutions never import student records in v1.
- `seed-data/rulesets.json` — NCAA eligibility rulesets are global,
  division-scoped configuration managed in the admin UI, not institution
  imports.
