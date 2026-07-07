import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { eligibilityRulesets } from "@/db/schema";

/**
 * Admin edit of an eligibility ruleset: rules JSON, source note, verified
 * flag. This is exactly how a compliance officer signs off on numbers
 * without a code change.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json()) as {
      rules?: unknown;
      sourceNote?: string | null;
      verified?: boolean;
    };
    const set: Record<string, unknown> = {};
    if (body.rules !== undefined) {
      if (typeof body.rules !== "object" || body.rules === null || Array.isArray(body.rules)) {
        return NextResponse.json(
          { error: "rules must be a JSON object" },
          { status: 400 },
        );
      }
      set.rules = body.rules;
    }
    if (body.sourceNote !== undefined) set.sourceNote = body.sourceNote;
    if (body.verified !== undefined) set.verified = !!body.verified;
    if (Object.keys(set).length === 0) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }
    const rows = await db
      .update(eligibilityRulesets)
      .set(set)
      .where(eq(eligibilityRulesets.id, id))
      .returning();
    if (rows.length === 0) {
      return NextResponse.json({ error: "Ruleset not found" }, { status: 404 });
    }
    return NextResponse.json({ ruleset: rows[0] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
