"use client";

import { useEffect, useState } from "react";

interface RulesetRow {
  id: string;
  division: string;
  effectiveDate: string;
  rules: Record<string, unknown>;
  sourceNote: string | null;
  verified: boolean;
}

export function RulesetsAdminClient() {
  const [rulesets, setRulesets] = useState<RulesetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/rulesets")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error);
        setRulesets(d.rulesets);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (error)
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        {error}
      </div>
    );
  if (rulesets.length === 0)
    return (
      <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
        No rulesets found. Run <code className="font-mono">pnpm seed</code> to
        load the seed rulesets.
      </div>
    );

  return (
    <div className="space-y-4">
      {rulesets.map((rs) => (
        <RulesetEditor
          key={rs.id}
          ruleset={rs}
          onSaved={(updated) =>
            setRulesets((list) =>
              list.map((x) => (x.id === updated.id ? updated : x)),
            )
          }
        />
      ))}
    </div>
  );
}

function RulesetEditor({
  ruleset,
  onSaved,
}: {
  ruleset: RulesetRow;
  onSaved: (r: RulesetRow) => void;
}) {
  const [rulesText, setRulesText] = useState(
    JSON.stringify(ruleset.rules, null, 2),
  );
  const [sourceNote, setSourceNote] = useState(ruleset.sourceNote ?? "");
  const [verified, setVerified] = useState(ruleset.verified);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = async () => {
    let rules: unknown;
    try {
      rules = JSON.parse(rulesText);
    } catch (e) {
      setJsonError(`Invalid JSON: ${(e as Error).message}`);
      return;
    }
    setJsonError(null);
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/rulesets/${ruleset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules, sourceNote, verified }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      onSaved(data.ruleset);
      setSavedAt(Date.now());
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-md border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2">
        <span className="text-sm font-bold text-slate-800">
          {ruleset.division}
        </span>
        <span className="text-xs text-slate-500">
          effective {ruleset.effectiveDate}
        </span>
        {verified ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-800 ring-1 ring-emerald-300">
            Verified
          </span>
        ) : (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-800 ring-1 ring-amber-300">
            Needs compliance verification
          </span>
        )}
        <label className="ml-auto flex items-center gap-1.5 text-xs font-medium text-slate-600">
          <input
            type="checkbox"
            checked={verified}
            onChange={(e) => setVerified(e.target.checked)}
          />
          Verified by compliance
        </label>
        <button
          onClick={save}
          disabled={saving}
          className="rounded bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-2">
        <label className="block text-xs">
          <span className="font-semibold text-slate-600">Rules (JSON)</span>
          <textarea
            className="mt-1 h-56 w-full rounded border border-slate-300 p-2 font-mono text-[11px] leading-snug"
            value={rulesText}
            onChange={(e) => setRulesText(e.target.value)}
            spellCheck={false}
          />
        </label>
        <label className="block text-xs">
          <span className="font-semibold text-slate-600">
            Source note (manual citation)
          </span>
          <textarea
            className="mt-1 h-56 w-full rounded border border-slate-300 p-2 text-xs leading-snug"
            value={sourceNote}
            onChange={(e) => setSourceNote(e.target.value)}
          />
        </label>
      </div>
      {(jsonError || saveError) && (
        <p className="px-4 pb-3 text-xs font-semibold text-red-700">
          {jsonError ?? saveError}
        </p>
      )}
      {savedAt && !jsonError && !saveError && (
        <p className="px-4 pb-3 text-xs text-emerald-700">Saved.</p>
      )}
    </div>
  );
}
