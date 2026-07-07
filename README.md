# DPlanner — Student-Athlete 4/5-Year Course Planner

An advisor-facing web app for university athletic departments. An academic
advisor sits down with a student-athlete and, in a few clicks, produces a
complete semester-by-semester course plan from enrollment through graduation —
with multiple strategic variants (graduate in 3–5 years, lighter in-season
load, front-load hard courses, summer-accelerated). Every generated plan is
automatically checked against NCAA eligibility rules.

> **Demo environment — sample data only. Not for use with real student records.**
>
> Eligibility results are decision-support only and must be confirmed by the
> institution's compliance office against the current NCAA manual. Rules vary
> by division and change by legislative cycle.

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS
- Postgres (Supabase-compatible) + Drizzle ORM
- Pure TypeScript domain engines in `src/lib/scheduler` and `src/lib/eligibility`
- Vitest

## Getting started

```bash
pnpm install
docker compose up -d db          # or set DATABASE_URL to any Postgres/Supabase
cp .env.example .env             # adjust DATABASE_URL if needed
pnpm db:migrate                  # apply schema
pnpm seed                        # load the LSU demo dataset
pnpm dev                         # http://localhost:3000
```

## Tests

```bash
pnpm test
```

## Project layout

- `src/db/` — Drizzle schema + client
- `src/lib/scheduler/` — pure-TS plan generation engine
- `src/lib/eligibility/` — pure-TS NCAA eligibility engine (data-driven rulesets)
- `src/lib/importer/` — CSV/JSON catalog importer with validation
- `seed-data/lsu/` — reference import template, filled with the LSU demo dataset
- `docs/` — import template documentation
