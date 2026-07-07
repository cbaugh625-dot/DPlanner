"use client";

import { useCallback, useEffect, useState } from "react";
import type { GradTarget, PlanFlag, Strategy } from "@/lib/types";
import { PlanGrid, type CourseIndexEntry } from "./PlanGrid";
import { EligibilityFlags, type RulesetSummary } from "./EligibilityFlags";
import { AthleticCalendarPanel } from "./AthleticCalendarPanel";
import type { AthleticCalendar } from "@/lib/types";
import type { ScheduleResult } from "@/lib/scheduler";

interface InstitutionRow {
  id: string;
  slug: string;
  name: string;
  division: string;
}
interface ProgramRow {
  id: string;
  slug: string;
  name: string;
  degreeType: string;
  type: "major" | "minor";
}
interface StudentRow {
  id: string;
  displayName: string;
  sport: string;
  enrollmentStartTerm: string;
  currentCumulativeGpa: number | null;
  incomingCredits: { source: string; credits: number }[];
}

export const TARGET_LABELS: Record<GradTarget, string> = {
  grad_3yr: "3 years",
  grad_3_5yr: "3.5 years",
  grad_4yr: "4 years",
  grad_4_5yr: "4.5 years",
  grad_5yr: "5 years",
};

export const STRATEGY_LABELS: Record<Strategy, string> = {
  balanced: "Balanced",
  front_load_hard: "Front-load hard courses",
  light_in_season: "Lighter in-season load",
  summer_accelerated: "Summer-accelerated",
};

export interface GenerateResponse {
  result: ScheduleResult;
  flags: PlanFlag[];
  ruleset: RulesetSummary | null;
  courseIndex: Record<string, CourseIndexEntry>;
  student: StudentRow & { division: string };
  program: { id: string; name: string; degreeType: string };
  secondaryProgram: { id: string; name: string } | null;
  minors: { id: string; name: string }[];
  athleticCalendar: AthleticCalendar | null;
}

export interface GeneratedPlan {
  response: GenerateResponse;
  target: GradTarget;
  strategy: Strategy;
}

export function PlannerClient({
  institutions,
}: {
  institutions: InstitutionRow[];
}) {
  const [institutionId, setInstitutionId] = useState(institutions[0]?.id ?? "");
  const [programs, setPrograms] = useState<ProgramRow[]>([]);
  const [studentsList, setStudentsList] = useState<StudentRow[]>([]);
  const [programId, setProgramId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [target, setTarget] = useState<GradTarget>("grad_4yr");
  const [strategy, setStrategy] = useState<Strategy>("balanced");
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<GeneratedPlan | null>(null);
  const [pinned, setPinned] = useState<GeneratedPlan | null>(null);

  useEffect(() => {
    if (!institutionId) return;
    setLoadingMeta(true);
    setPlan(null);
    setPinned(null);
    fetch(`/api/institutions/${institutionId}/meta`)
      .then((r) => r.json())
      .then((data) => {
        const progs = (data.programs as ProgramRow[]) ?? [];
        setPrograms(progs);
        setStudentsList((data.students as StudentRow[]) ?? []);
        setProgramId(progs.find((p) => p.type === "major")?.id ?? "");
        setStudentId((data.students?.[0] as StudentRow | undefined)?.id ?? "");
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoadingMeta(false));
  }, [institutionId]);

  const generate = useCallback(
    async (overrides?: { target?: GradTarget; strategy?: Strategy }) => {
      const useTarget = overrides?.target ?? target;
      const useStrategy = overrides?.strategy ?? strategy;
      setGenerating(true);
      setError(null);
      try {
        const res = await fetch("/api/plans/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            institutionId,
            programId,
            studentId,
            target: useTarget,
            strategy: useStrategy,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to generate plan");
        setPlan({
          response: data as GenerateResponse,
          target: useTarget,
          strategy: useStrategy,
        });
      } catch (e) {
        setError((e as Error).message);
        setPlan(null);
      } finally {
        setGenerating(false);
      }
    },
    [institutionId, programId, studentId, target, strategy],
  );

  const selectedStudent = studentsList.find((s) => s.id === studentId);

  return (
    <div className="space-y-5">
      <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
          <Select
            label="Institution"
            value={institutionId}
            onChange={setInstitutionId}
            options={institutions.map((i) => ({
              value: i.id,
              label: `${i.name} (${i.division})`,
            }))}
          />
          <Select
            label="Program / Major"
            value={programId}
            onChange={setProgramId}
            disabled={loadingMeta}
            options={programs
              .filter((p) => p.type === "major")
              .map((p) => ({
                value: p.id,
                label: `${p.name} (${p.degreeType})`,
              }))}
          />
          <Select
            label="Sample student"
            value={studentId}
            onChange={setStudentId}
            disabled={loadingMeta}
            options={studentsList.map((s) => ({
              value: s.id,
              label: `${s.displayName} — ${s.sport}`,
            }))}
          />
          <Select
            label="Graduation target"
            value={target}
            onChange={(v) => setTarget(v as GradTarget)}
            options={Object.entries(TARGET_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <Select
            label="Strategy"
            value={strategy}
            onChange={(v) => setStrategy(v as Strategy)}
            options={Object.entries(STRATEGY_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <div className="flex items-end">
            <button
              onClick={() => generate()}
              disabled={!programId || !studentId || generating}
              className="w-full rounded bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
            >
              {generating ? "Generating…" : plan ? "Regenerate" : "Generate plan"}
            </button>
          </div>
        </div>
        {selectedStudent && (
          <p className="mt-3 text-xs text-slate-500">
            {selectedStudent.displayName} · {selectedStudent.sport} · starts{" "}
            {selectedStudent.enrollmentStartTerm} · GPA{" "}
            {selectedStudent.currentCumulativeGpa ?? "—"} ·{" "}
            {selectedStudent.incomingCredits.length > 0
              ? `${selectedStudent.incomingCredits.reduce((s, c) => s + c.credits, 0)} incoming credits (${selectedStudent.incomingCredits.map((c) => c.source).join(", ")})`
              : "no incoming credit"}
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {plan && !pinned && (
        <div className="no-print flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-slate-600">
            See a different path:
          </span>
          {(Object.keys(STRATEGY_LABELS) as Strategy[])
            .filter((s) => s !== plan.strategy)
            .map((s) => (
              <button
                key={s}
                onClick={() => {
                  setStrategy(s);
                  generate({ strategy: s });
                }}
                className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:border-indigo-400 hover:text-indigo-700"
              >
                {STRATEGY_LABELS[s]}
              </button>
            ))}
          <span className="mx-1 text-slate-300">|</span>
          <button
            onClick={() => setPinned(plan)}
            className="rounded-full border border-indigo-300 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
          >
            Pin this plan for comparison
          </button>
        </div>
      )}

      {pinned && (
        <div className="no-print flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-slate-600">
            Comparing against pinned plan — change target/strategy and
            regenerate to update the right side.
          </span>
          <button
            onClick={() => setPinned(null)}
            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:border-red-300 hover:text-red-700"
          >
            Unpin
          </button>
        </div>
      )}

      {plan && pinned ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <PlanPanel plan={pinned} tag="Pinned" />
          <PlanPanel plan={plan} tag="Current" />
        </div>
      ) : plan ? (
        <PlanPanel plan={plan} />
      ) : null}
    </div>
  );
}

export function PlanPanel({
  plan,
  tag,
}: {
  plan: GeneratedPlan;
  tag?: string;
}) {
  const { response } = plan;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {tag && (
          <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-slate-600">
            {tag}
          </span>
        )}
        <h2 className="text-lg font-bold text-slate-900">
          {response.student.displayName} — {response.program.name} (
          {response.program.degreeType})
        </h2>
        <span className="text-sm text-slate-500">
          {TARGET_LABELS[plan.target]} · {STRATEGY_LABELS[plan.strategy]}
        </span>
        <span className="text-xs text-slate-400">
          {response.result.deliveredPrimaryTerms} semesters ·{" "}
          {response.result.totalCreditsRequired} credits required
        </span>
      </div>
      {!response.result.feasible && response.result.explanation && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-semibold">Target not met: </span>
          {response.result.explanation}
        </div>
      )}
      {response.result.dataErrors.length > 0 && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {response.result.dataErrors.join(" ")}
        </div>
      )}
      <AthleticCalendarPanel calendar={response.athleticCalendar} />
      <EligibilityFlags flags={response.flags} ruleset={response.ruleset} />
      <PlanGrid
        terms={response.result.terms}
        courseIndex={response.courseIndex}
        flags={response.flags}
      />
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="font-semibold text-slate-700">{label}</span>
      <select
        className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
