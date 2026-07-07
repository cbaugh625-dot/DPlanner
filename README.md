# DPlanner — Student-Athlete 4/5-Year Course Planner

An advisor-facing web app for university athletic departments, sold
per-institution. An academic advisor sits down with a student-athlete and, in
a few clicks, produces a complete semester-by-semester course plan from
enrollment through graduation — with multiple strategic variants — and every
plan is automatically checked against NCAA eligibility rules.

> **Demo environment — sample data only. Not for use with real student records.**
>
> Eligibility results are decision-support only and must be confirmed by the
> institution's compliance office against the current NCAA manual. Rules vary
> by division and change by legislative cycle.

## Features

- **Multi-year plan generation** — graduation targets of 3 / 3.5 / 4 / 4.5 / 5
  years; strategies: balanced, front-load hard courses, lighter in-season
  load, summer-accelerated. Infeasible targets return the closest feasible
  plan plus a plain-language explanation.
- **NCAA eligibility engine** — data-driven rulesets per division and
  effective date (6-hour term minimum, full-time enrollment, 24-hour annual
  rule with the 18-hour fall+spring subset, 24-by-third-semester, 40-60-80
  percentage-of-degree, GPA thresholds, 5-year clock). Numbers are
  configuration, never code constants; unverified rulesets are visibly
  flagged until compliance signs off in the admin UI.
- **Athletic-season awareness** — championship terms marked on the grid,
  in-season credit caps and hard-course avoidance, practice/travel display,
  overload warnings.
- **Edge cases** — AP/IB/CLEP/dual-enrollment/transfer credit (against
  courses or requirement buckets), summer/winter terms, minors, double
  majors with a configurable PTD denominator, study-abroad terms.
- **Advisor workflow** — instant regeneration, "see a different path"
  quick-switches, side-by-side plan comparison, print/PDF export with the
  compliance disclaimer, persistent demo-data banner. Nothing is auto-saved.
- **Institution onboarding** — CSV/JSON import template with strict
  validation that reports every error at once and imports nothing on
  failure; idempotent re-runs. See [docs/import-template.md](docs/import-template.md).

## Stack

Next.js (App Router) + TypeScript + Tailwind CSS · Postgres
(Supabase-compatible) + Drizzle ORM · pure-TypeScript domain engines in
`src/lib/scheduler` and `src/lib/eligibility` · Vitest.

## Getting started

```bash
pnpm install
docker compose up -d db          # or point DATABASE_URL at any Postgres/Supabase
cp .env.example .env
pnpm db:migrate                  # apply schema
pnpm seed                        # load the LSU demo dataset (illustrative data)
pnpm dev                         # http://localhost:3000
```

The seed loads a Division I demo: Mechanical Engineering (deep prerequisite
chains) and Sport Administration (shallow) majors, a Business minor, 67
courses with fall-only/spring-only/alternate-year offerings, four athletic
calendars (football, baseball, softball, women's basketball), four sample
student-athletes with varied GPAs and incoming credit, and eligibility
rulesets for D1 (seeded values, `verified: false`) plus D2/D3/NAIA
placeholders.

## Tests

```bash
pnpm test        # 62 tests across the scheduler, eligibility engine, importer
```

## Project layout

- `src/db/` — Drizzle schema + client (all data scoped by `institution_id`)
- `src/lib/scheduler/` — plan generation engine (pure TS, no framework)
- `src/lib/eligibility/` — NCAA eligibility engine (pure TS, ruleset-driven)
- `src/lib/importer/` — catalog importer with full-report validation
- `src/app/` — planner UI, admin ruleset editor (`/admin/rulesets`), API routes
- `seed-data/lsu/` — reference import template filled with the demo dataset
- `docs/import-template.md` — import file documentation

## Out of scope for v1 (seams built, features not)

Real SIS integration (Banner/Workday/PeopleSoft/Colleague) and real student
data; time-of-day class-vs-practice conflict resolution against live section
schedules; authentication beyond a simple advisor login; production use of
non-verified division rulesets.
