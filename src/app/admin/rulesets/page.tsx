import { RulesetsAdminClient } from "@/components/RulesetsAdminClient";

export const dynamic = "force-dynamic";

export default function RulesetsAdminPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="text-xl font-bold text-slate-900">Eligibility rulesets</h1>
      <p className="mb-5 mt-1 text-sm text-slate-500">
        NCAA eligibility numbers are configuration, not code. Edit a
        division&apos;s rules here and mark them{" "}
        <span className="font-semibold">verified</span> once your compliance
        office has confirmed them against the current manual. Unverified
        rulesets show a &quot;needs compliance verification&quot; badge on
        every plan they check.
      </p>
      <RulesetsAdminClient />
    </div>
  );
}
