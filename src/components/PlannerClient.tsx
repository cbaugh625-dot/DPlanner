"use client";

import { useCallback, useEffect, useState } from "react";
import type { GradTarget, Strategy } from "@/lib/types";
import { PlanGrid, type CourseIndexEntry } from "./PlanGrid";
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

export interface GenerateResponse {
  result: ScheduleResult;
  courseIndex: Record<string, CourseIndexEntry>;
  student: StudentRow & { division: string };
  program: { id: string; name: string; degreeType: string };
  secondaryProgram: { id: string; name: string } | null;
  minors: { id: string; name: string }[];
  athleticCalendar: unknown;
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
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<GenerateResponse | null>(null);

  useEffect(() => {
    if (!institutionId) return;
    setLoadingMeta(true);
    setPlan(null);
    fetch(`/api/institutions/${institutionId}/meta`)
      .then((r) => r.json())
      .then((data) => {
        const majors = (data.programs as ProgramRow[]) ?? [];
        setPrograms(majors);
        setStudentsList((data.students as StudentRow[]) ?? []);
        setProgramId(majors.find((p) => p.type === "major")?.id ?? "");
        setStudentId((data.students?.[0] as StudentRow | undefined)?.id ?? "");
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoadingMeta(false));
  }, [institutionId]);

  const generate = useCallback(async () => {
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
          target: "grad_4yr" satisfies GradTarget,
          strategy: "balanced" satisfies Strategy,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to generate plan");
      setPlan(data as GenerateResponse);
    } catch (e) {
      setError((e as Error).message);
      setPlan(null);
    } finally {
      setGenerating(false);
    }
  }, [institutionId, programId, studentId]);

  const selectedStudent = studentsList.find((s) => s.id === studentId);

  return (
    <div className="space-y-5">
      <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-4 md:grid-cols-4">
          <label className="block text-sm">
            <span className="font-semibold text-slate-700">Institution</span>
            <select
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={institutionId}
              onChange={(e) => setInstitutionId(e.target.value)}
            >
              {institutions.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.division})
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-slate-700">Program / Major</span>
            <select
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={programId}
              onChange={(e) => setProgramId(e.target.value)}
              disabled={loadingMeta}
            >
              {programs
                .filter((p) => p.type === "major")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.degreeType})
                  </option>
                ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-slate-700">Sample student</span>
            <select
              className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              disabled={loadingMeta}
            >
              {studentsList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName} — {s.sport}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button
              onClick={generate}
              disabled={!programId || !studentId || generating}
              className="w-full rounded bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50"
            >
              {generating ? "Generating…" : "Generate plan"}
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

      {plan && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-lg font-bold text-slate-900">
              {plan.student.displayName} — {plan.program.name} (
              {plan.program.degreeType})
            </h2>
            <span className="text-sm text-slate-500">
              4-year target · balanced strategy
            </span>
          </div>
          {!plan.result.feasible && plan.result.explanation && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span className="font-semibold">Target not met: </span>
              {plan.result.explanation}
            </div>
          )}
          {plan.result.dataErrors.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {plan.result.dataErrors.join(" ")}
            </div>
          )}
          <PlanGrid terms={plan.result.terms} courseIndex={plan.courseIndex} />
        </div>
      )}
    </div>
  );
}
